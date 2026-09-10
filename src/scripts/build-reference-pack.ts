/**
 * Build a persona's competitor reference pack + distilled style brief
 * (docs/SPEC-reference-packs.md). For each competitor YouTube URL: pull
 * metadata + English auto-subs via yt-dlp, describe the thumbnail with Claude
 * vision (haiku), upsert one reference_packs row per video. Then ONE
 * distillation call over ALL of the persona's rows (previous runs included —
 * re-runs strengthen the brief) produces a <=1500-char style brief written to
 * personas.style_brief.
 *
 * Writes ONLY reference_packs + personas.style_brief — never topics or
 * content_pieces (anything inserted there gets auto-built and auto-published
 * by the crons).
 *
 * Idempotent: upsert on (persona_id, source_video_id).
 *
 * Run (dry run — prints everything, writes nothing):
 *   npx tsx --env-file=.env.local src/scripts/build-reference-pack.ts \
 *     --persona <uuid> --videos <url1,url2,...> [--max 5]
 * Commit (upserts rows + updates personas.style_brief):
 *   npx tsx --env-file=.env.local src/scripts/build-reference-pack.ts \
 *     --persona <uuid> --videos <url1,url2,...> [--max 5] --commit
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { claude } from '../lib/claude';
import { referencePackBriefSchema } from '../lib/schemas';

const BRIEF_MAX_CHARS = 1500;
const TRANSCRIPT_MAX_CHARS = 4000;

const args = process.argv.slice(2);
const argVal = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PERSONA_ID = argVal('--persona', '');
const VIDEOS_ARG = argVal('--videos', '');
const MAX = Math.max(1, parseInt(argVal('--max', '5'), 10) || 5);
const COMMIT = args.includes('--commit');

function usage(): never {
    console.error(`Usage:
  npx tsx --env-file=.env.local src/scripts/build-reference-pack.ts \\
    --persona <uuid> --videos <url1,url2,...> [--max 5] [--commit]

Dry-run by default (prints the pack + brief, writes nothing).
--commit upserts reference_packs rows and updates personas.style_brief.`);
    process.exit(1);
}

interface PersonaRow {
    id: string;
    name: string;
    brand: string;
    platform_accounts: Record<string, string> | null;
}

interface YtDlpMeta {
    id: string;
    title: string;
    channel?: string;
    uploader?: string;
    uploader_id?: string;
    channel_id?: string;
    view_count?: number;
    like_count?: number;
    duration?: number;
    upload_date?: string;
    thumbnail?: string;
    thumbnails?: { url: string }[];
    webpage_url?: string;
}

interface PackRecord {
    persona_id: string;
    source_video_id: string;
    source_channel: string | null;
    source_url: string;
    title: string;
    view_count: number | null;
    duration_seconds: number | null;
    transcript_excerpt: string | null;
    thumbnail_url: string | null;
    thumbnail_style_notes: string | null;
    metadata: Record<string, unknown>;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const norm = (s: string) => s.trim().toLowerCase().replace(/^@/, '');

/** yt-dlp metadata only — no download. Returns null (with [WARN]) on failure. */
function fetchMetadata(url: string): YtDlpMeta | null {
    try {
        const out = execFileSync('yt-dlp', ['--dump-json', '--skip-download', url], {
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        });
        return JSON.parse(out) as YtDlpMeta;
    } catch (e) {
        console.warn(`[WARN] metadata failed for ${url} — skipping video: ${errMsg(e)}`);
        return null;
    }
}

/** English auto-sub VTT via yt-dlp into a temp dir, cleaned. Null if unavailable. */
function fetchTranscript(url: string, videoId: string): string | null {
    const tmp = mkdtempSync(path.join(tmpdir(), 'refpack-'));
    try {
        execFileSync(
            'yt-dlp',
            ['--skip-download', '--write-auto-sub', '--sub-lang', 'en', '--sub-format', 'vtt',
                '-o', path.join(tmp, '%(id)s'), url],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const vttFile = readdirSync(tmp).find((f) => f.endsWith('.vtt'));
        if (!vttFile) return null;
        return cleanVtt(readFileSync(path.join(tmp, vttFile), 'utf8')) || null;
    } catch (e) {
        console.warn(`[WARN] subtitle fetch failed for ${videoId}: ${errMsg(e)}`);
        return null;
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

/** Strip cue timestamps/tags, dedupe consecutive lines (auto-subs repeat), cap length. */
function cleanVtt(vtt: string): string {
    const out: string[] = [];
    for (const line of vtt.split(/\r?\n/)) {
        if (line.includes('-->')) continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^WEBVTT/.test(trimmed) || /^(Kind|Language):/i.test(trimmed) || /^\d+$/.test(trimmed)) continue;
        const text = trimmed
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
            .trim();
        if (!text) continue;
        if (out[out.length - 1] === text) continue;
        out.push(text);
    }
    return out.join(' ').slice(0, TRANSCRIPT_MAX_CHARS);
}

/** yt-dlp lists thumbnails ascending by preference — `thumbnail` is the best one. */
function pickThumbnail(meta: YtDlpMeta): string | null {
    if (meta.thumbnail) return meta.thumbnail;
    const thumbs = meta.thumbnails ?? [];
    return thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

function imageMediaType(url: string, contentType: string | null): ImageMediaType {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.includes('webp')) return 'image/webp';
    if (ct.includes('png')) return 'image/png';
    if (ct.includes('gif')) return 'image/gif';
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'image/jpeg';
    // i.ytimg.com commonly serves webp variants
    if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
    if (/\.png(\?|$)/i.test(url)) return 'image/png';
    return 'image/jpeg';
}

/** Compact composition description of the thumbnail via Claude vision.
 *  Per-call haiku override — shared defaults in claude.ts stay untouched
 *  (claude.ts has no general image+text method, so this script-local call
 *  uses the SDK directly; never bundled). */
async function describeThumbnail(anthropic: Anthropic, thumbUrl: string): Promise<string | null> {
    const res = await fetch(thumbUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`thumbnail fetch failed: HTTP ${res.status}`);
    const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: 'You describe YouTube thumbnail composition for a style archive. Be compact and concrete. Patterns only — never transcribe the exact overlay wording.',
        messages: [{
            role: 'user',
            content: [
                {
                    type: 'image',
                    source: { type: 'base64', media_type: imageMediaType(thumbUrl, res.headers.get('content-type')), data: base64 },
                },
                {
                    type: 'text',
                    text: 'Describe this thumbnail in 3-5 short sentences: layout, text treatment (size/placement/style), color strategy, facial expression/emotion if a face is present, and the focal object.',
                },
            ],
        }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text.trim() : null;
}

const BRIEF_TOOL_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        brief: {
            type: 'string',
            description: 'The distilled niche style brief. At most 1500 characters. Exactly four labeled sections: TITLES / HOOKS / STRUCTURE / THUMBNAILS.',
        },
    },
    required: ['brief'],
    additionalProperties: false,
};

const DISTILL_SYSTEM = `You distill competitor video research into a compact niche style brief that guides ORIGINAL content generation for a different creator. The brief teaches structure — title shapes, hook mechanics, pacing beats, thumbnail composition — never wording.

HARD RULES:
- NEVER quote or paraphrase any specific competitor sentence or title verbatim. Describe the pattern, never the instance.
- No double quotes anywhere in the brief.
- No JSON examples in the brief.
- Write imperative guidance (Open with..., Titles pose...).
- At most ${BRIEF_MAX_CHARS} characters total.
- Exactly four sections, labeled TITLES / HOOKS / STRUCTURE / THUMBNAILS.`;

function buildDistillUser(persona: PersonaRow, rows: PackRecord[]): string {
    const blocks = rows.map((r, i) => {
        const lines = [
            `VIDEO ${i + 1}: ${r.title}`,
            `Channel: ${r.source_channel ?? 'unknown'} | Views: ${r.view_count?.toLocaleString() ?? 'unknown'} | Duration: ${r.duration_seconds ?? '?'}s`,
        ];
        if (r.thumbnail_style_notes) lines.push(`Thumbnail composition: ${r.thumbnail_style_notes}`);
        if (r.transcript_excerpt) lines.push(`Transcript excerpt:\n${r.transcript_excerpt}`);
        return lines.join('\n');
    });
    return `PERSONA: ${persona.name} (${persona.brand})

TOP COMPETITOR VIDEOS IN THIS NICHE (${rows.length}):

${blocks.join('\n\n')}

Distill the niche style brief now.`;
}

async function main() {
    // Arg validation FIRST — the usage-error path must not touch env or network.
    if (!PERSONA_ID || !VIDEOS_ARG) usage();
    const urls = VIDEOS_ARG.split(',').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) usage();
    if (urls.length > MAX) {
        console.error(`[ERR] ${urls.length} videos exceeds --max ${MAX} — refusing`);
        process.exit(1);
    }
    // Guard: only http(s) URLs — anything else (notably strings starting with
    // '-') would be parsed by yt-dlp as a flag (argv option injection).
    const badUrl = urls.find((u) => !/^https?:\/\//i.test(u));
    if (badUrl) {
        console.error(`[ERR] "${badUrl}" is not an http(s) URL — refusing`);
        process.exit(1);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!supabaseUrl || !serviceKey || !anthropicKey) {
        console.error('[ERR] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY — run with --env-file=.env.local');
        process.exit(1);
    }

    const sb = createClient(supabaseUrl, serviceKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Guard: --persona must match an existing personas row.
    const { data: personaData, error: pErr } = await sb
        .from('personas').select('id, name, brand, platform_accounts').eq('id', PERSONA_ID).single();
    if (pErr || !personaData) {
        console.error(`[ERR] persona ${PERSONA_ID} not found: ${pErr?.message ?? 'no row'}`);
        process.exit(1);
    }
    const persona = personaData as PersonaRow;

    console.log(`\n${COMMIT ? '=== COMMIT ===' : '=== DRY RUN (no writes) ==='}`);
    console.log(`Persona: ${persona.name} (${persona.brand}) | ${urls.length} video(s), max ${MAX}\n`);

    // Guard: the persona's own channels (self-reference is what topWinners
    // already covers). Own identity = persona name + brand + the registered
    // handles behind its Blotato platform accounts.
    const ownChannels = new Set<string>([norm(persona.name), norm(persona.brand)]);
    const accountIds = Object.values(persona.platform_accounts ?? {}).filter((v): v is string => typeof v === 'string');
    if (accountIds.length > 0) {
        const { data: accounts } = await sb
            .from('blotato_accounts').select('handle').in('account_id', accountIds);
        for (const a of (accounts ?? []) as { handle: string }[]) ownChannels.add(norm(a.handle));
    }

    const batch: PackRecord[] = [];
    let skipped = 0;

    for (const url of urls) {
        const meta = fetchMetadata(url);
        if (!meta) { skipped++; continue; }

        const channelNames = [meta.channel, meta.uploader, meta.uploader_id]
            .filter((s): s is string => typeof s === 'string');
        if (channelNames.some((c) => ownChannels.has(norm(c)))) {
            console.error(`[ERR] ${meta.id} ("${meta.channel ?? meta.uploader}") is the persona's own channel — refusing self-reference`);
            skipped++;
            continue;
        }

        const transcript = fetchTranscript(url, meta.id);
        if (!transcript) console.warn(`[WARN] no English auto-subs for ${meta.id} — proceeding with metadata only`);

        const thumbnailUrl = pickThumbnail(meta);
        let thumbnailNotes: string | null = null;
        if (thumbnailUrl) {
            try {
                thumbnailNotes = await describeThumbnail(anthropic, thumbnailUrl);
            } catch (e) {
                console.warn(`[WARN] thumbnail vision failed for ${meta.id}: ${errMsg(e)}`);
            }
        } else {
            console.warn(`[WARN] no thumbnail URL for ${meta.id}`);
        }

        const record: PackRecord = {
            persona_id: persona.id,
            source_video_id: meta.id,
            source_channel: meta.channel ?? meta.uploader ?? null,
            source_url: meta.webpage_url ?? url,
            title: meta.title,
            view_count: meta.view_count ?? null,
            duration_seconds: typeof meta.duration === 'number' ? Math.round(meta.duration) : null,
            transcript_excerpt: transcript,
            thumbnail_url: thumbnailUrl,
            thumbnail_style_notes: thumbnailNotes,
            metadata: {
                upload_date: meta.upload_date ?? null,
                like_count: meta.like_count ?? null,
                channel_id: meta.channel_id ?? null,
            },
        };

        if (COMMIT) {
            const { error: upErr } = await sb
                .from('reference_packs')
                .upsert(record, { onConflict: 'persona_id,source_video_id' });
            if (upErr) {
                console.error(`[ERR] upsert failed for ${meta.id}: ${upErr.message}`);
                skipped++;
                continue;
            }
        }
        console.log(`[ok] ${meta.id}  "${meta.title.slice(0, 60)}"  ${meta.view_count?.toLocaleString() ?? '?'} views  transcript=${transcript ? `${transcript.length} chars` : 'none'}  thumbnail=${thumbnailNotes ? 'described' : 'none'}`);
        batch.push(record);
    }

    // Distill over ALL rows for the persona: previously ingested + this batch
    // (batch wins on video id so dry-runs see exactly what a commit would).
    const { data: existingRows, error: exErr } = await sb
        .from('reference_packs').select('*').eq('persona_id', persona.id);
    if (exErr) {
        console.error(`[ERR] reference_packs read failed: ${exErr.message} — aborting before distillation`);
        process.exit(1);
    }
    const byVideo = new Map<string, PackRecord>();
    for (const r of (existingRows ?? []) as PackRecord[]) byVideo.set(r.source_video_id, r);
    for (const r of batch) byVideo.set(r.source_video_id, r);
    const rows = [...byVideo.values()];
    if (rows.length === 0) {
        console.error('[ERR] no videos ingested and none previously stored — nothing to distill');
        process.exit(1);
    }

    console.log(`\nDistilling style brief from ${rows.length} video(s)...`);
    const { data, inputTokens, outputTokens } = await claude.generateStructured<{ brief: string }>(
        DISTILL_SYSTEM,
        buildDistillUser(persona, rows),
        {
            name: 'emit_style_brief',
            description: 'Return the distilled niche style brief.',
            inputSchema: BRIEF_TOOL_SCHEMA,
        },
    );
    console.log(`Claude tokens in/out: ${inputTokens}/${outputTokens}`);

    // Sanitize at ingest (the prompt injection sanitizes again as defense in depth).
    const cleaned = (data.brief ?? '').replace(/"/g, "'").trim().slice(0, BRIEF_MAX_CHARS);
    const parsed = referencePackBriefSchema.safeParse({ brief: cleaned });
    if (!parsed.success) {
        console.error(`[ERR] distillation output failed validation: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
        process.exit(1);
    }
    const brief = parsed.data.brief;

    if (COMMIT) {
        const { error: uErr } = await sb
            .from('personas').update({ style_brief: brief }).eq('id', persona.id);
        if (uErr) {
            console.error(`[ERR] personas.style_brief update failed: ${uErr.message}`);
            process.exit(1);
        }
        console.log(`[ok] personas.style_brief updated for ${persona.name}`);
    }

    console.log(`\n===== STYLE BRIEF =====\n${brief}\n`);
    console.log('===== SUMMARY =====');
    console.log(`Mode:            ${COMMIT ? 'COMMIT' : 'DRY RUN (no writes)'}`);
    console.log(`Persona:         ${persona.name} (${persona.brand})`);
    console.log(`Videos ingested: ${batch.length} this run (${rows.length} total in pack), skipped ${skipped}`);
    console.log(`Brief length:    ${brief.length} chars (cap ${BRIEF_MAX_CHARS})`);
    if (COMMIT) {
        console.log('The brief goes live at the next cron firing once this branch is deployed — no route changes needed.');
    } else {
        console.log('Re-run with --commit to upsert reference_packs + update personas.style_brief.');
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
