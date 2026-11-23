/**
 * NEC TikTok piece-link backfill. One command links existing
 * performance_metrics rows for TikTok @northeastcorner1 to their NEC ledger clip.
 *
 *   npx tsx --env-file=.env.local src/scripts/nec-tiktok-link-backfill.ts --out <dir> [--ledger <ledger.json>] [--apply]
 *
 * Default is a DRY RUN: it reads the ledger, Blotato (GET only) and
 * performance_metrics, and writes to <dir>:
 *   nec-tiktok-link-plan.json    every post with its match result, and the rows that would change
 *   nec-tiktok-link-backup.json  the full current content of every row that would change (the backup)
 * It writes nothing to the database.
 *
 * --apply (only after qcheck and the piece_key migration) fills, on exactly the
 * planned rows, piece_key where it is still null and video_id (the matched
 * TikTok video id) where it is still null. It changes no other field. Rows
 * written before the collector kept the TikTok URL have video_id null, and
 * analytics-pull carries a link forward only from rows holding both video_id
 * and piece_key, so filling video_id here is what lets links carry.
 * Undo, from nec-tiktok-link-backup.json (it holds every changed row as it was):
 *   update performance_metrics set piece_key = null where id in (all backup ids);
 *   update performance_metrics set video_id = null where id in (backup ids whose video_id is null);
 *
 * Run order: 1. the piece_key migration (20261122180000), 2. this command with
 * --apply, 3. deploy the collector. Steps 2 and 3 may also run the other way
 * round. Either way, every later pull carries the links, because the rows the
 * backfill fills hold both video_id and piece_key.
 *
 * Match rule: src/lib/nec-tiktok-link.ts (TikTok video id first, normalized URL
 * second, two ledger clips for one post refused).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import {
    NEC_TIKTOK_HANDLE,
    readLedgerClips,
    resolveLedgerPublicUrls,
    buildNecLinkIndex,
    matchNecPost,
    tiktokVideoId,
    type NecLinkResult,
} from '@/lib/nec-tiktok-link';

const DEFAULT_LEDGER = 'D:/Projects/fhcontent-creator-v2/operations/necorner-batch-2026-09-30/ledger.json';
const POSTS_SINCE = '2026-07-01T00:00:00.000Z';
const PAGE = 1000;

export interface MetricRow {
    id: string;
    blotato_post_id: string | null;
    video_id: string | null;
    post_url: string | null;
    piece_key?: string | null;
    [k: string]: unknown;
}

export interface LinkChange {
    id: string;
    /** Absent when the row already holds this key and only needs its video_id. */
    piece_key?: string;
    /** Set only when the row has no video_id and the match found one. */
    video_id?: string;
}

export interface PostPlan {
    postKey: string; // blotato_post_id, or video id for rows without one
    blotatoPostId: string | null;
    url: string | null;
    urlSource: 'row' | 'blotato_posts' | 'none';
    rows: number;
    result: NecLinkResult;
}

/** Pure planning step: group rows by post, find each post's URL, match it.
 *  A row keyed but still without video_id (an --apply that stopped between its
 *  key and video writes) is planned again for the video_id alone, so a rerun
 *  finishes it; its key is never changed. */
export function planLinks(
    rows: MetricRow[],
    urlByPostId: Map<string, string>,
    index: ReturnType<typeof buildNecLinkIndex>,
): { posts: PostPlan[]; changes: LinkChange[] } {
    const groups = new Map<string, MetricRow[]>();
    for (const r of rows) {
        if (r.piece_key && r.video_id) continue; // linked and carrying: never touched
        const key = r.blotato_post_id ?? (r.video_id ? `video:${r.video_id}` : r.post_url ? `url:${r.post_url}` : `row:${r.id}`);
        const g = groups.get(key) ?? [];
        g.push(r);
        groups.set(key, g);
    }
    const posts: PostPlan[] = [];
    const changes: LinkChange[] = [];
    for (const [postKey, g] of groups) {
        const withUrl = g.find((r) => r.post_url || r.video_id);
        const bpid = g[0].blotato_post_id;
        let url: string | null = withUrl?.post_url ?? null;
        let urlSource: PostPlan['urlSource'] = withUrl ? 'row' : 'none';
        if (!withUrl && bpid && urlByPostId.has(bpid)) {
            url = urlByPostId.get(bpid) ?? null;
            urlSource = 'blotato_posts';
        }
        let result = matchNecPost({ videoId: withUrl?.video_id ?? tiktokVideoId(url), url }, index);
        if (result.status === 'unlinked' && urlSource === 'none') {
            result = { ...result, reason: `Blotato published-post list returned no URL for post ${bpid ?? postKey}` };
        }
        if (result.status === 'linked') {
            const vid = result.videoId;
            for (const r of g) {
                const addVideo = vid && !r.video_id ? { video_id: vid } : {};
                if (!r.piece_key) changes.push({ id: r.id, piece_key: result.pieceKey, ...addVideo });
                else if (r.piece_key === result.pieceKey && 'video_id' in addVideo) changes.push({ id: r.id, ...addVideo });
            }
        }
        posts.push({ postKey, blotatoPostId: bpid, url, urlSource, rows: g.length, result });
    }
    return { posts, changes };
}

type UpdateClient = {
    from: (t: string) => {
        update: (v: Record<string, unknown>) => {
            in: (c: string, ids: string[]) => {
                is: (c: string, v: null) => { select: (c: string) => PromiseLike<{ data: Array<{ id: string }> | null; error: { message: string } | null }> };
            };
        };
    };
};

/** Write the planned links: piece_key per key, then video_id per video, each
 *  only where the field is still null. Returns the rows each write changed. */
export async function applyLinkChanges(supabase: UpdateClient, changes: LinkChange[]): Promise<{ pieceKeys: number; videoIds: number }> {
    const done = { pieceKeys: 0, videoIds: 0 };
    const write = async (field: 'piece_key' | 'video_id', value: string, ids: string[]) => {
        const { data, error } = await supabase
            .from('performance_metrics')
            .update({ [field]: value })
            .in('id', ids)
            .is(field, null)
            .select('id');
        if (error) throw new Error(`${field} update for ${value} failed after ${done.pieceKeys} piece_key and ${done.videoIds} video_id rows: ${error.message}`);
        return data?.length ?? 0;
    };
    for (const pk of new Set(changes.flatMap((c) => (c.piece_key ? [c.piece_key] : [])))) {
        done.pieceKeys += await write('piece_key', pk, changes.filter((c) => c.piece_key === pk).map((c) => c.id));
    }
    for (const vid of new Set(changes.flatMap((c) => (c.video_id ? [c.video_id] : [])))) {
        done.videoIds += await write('video_id', vid, changes.filter((c) => c.video_id === vid).map((c) => c.id));
    }
    return done;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const BACKUP_FILE = 'nec-tiktok-link-backup.json';
export const PLAN_FILE = 'nec-tiktok-link-plan.json';

/** Refuse an --out folder that already holds a backup or plan. A rerun into the
 *  same folder would overwrite the first run's backup with rows already changed. */
export function assertFreshOut(out: string): void {
    for (const f of [BACKUP_FILE, PLAN_FILE]) {
        if (fs.existsSync(path.join(out, f))) throw new Error(`--out ${out} already holds ${f}; use a new folder so the earlier backup is kept`);
    }
}

/** Blotato read with pacing: wait between calls, and on HTTP 429 wait the
 *  seconds Blotato names (default 60) and retry, up to 4 tries. */
export async function withRateLimit<T>(call: () => Promise<T>, pauseMs = 700, tries = 4, wait: (ms: number) => Promise<unknown> = sleep): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        await wait(pauseMs);
        try {
            return await call();
        } catch (e) {
            const msg = (e as Error).message ?? '';
            if (!/\(429\)/.test(msg) || attempt >= tries) throw e;
            const secs = Number(msg.match(/retry in (\d+) seconds/)?.[1] ?? 60);
            await wait((secs + 2) * 1000);
        }
    }
}

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
    const out = arg('--out');
    if (!out) throw new Error('--out <dir> is required');
    const ledgerPath = arg('--ledger') ?? DEFAULT_LEDGER;
    const apply = process.argv.includes('--apply');
    fs.mkdirSync(out, { recursive: true });
    assertFreshOut(out);

    // 1. Ledger clips, resolved to live TikTok URLs (Blotato GET /v2/posts/{uuid}).
    const clips = readLedgerClips(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')));
    const { clips: resolved, errors: resolveErrors } = await resolveLedgerPublicUrls(clips, (id) => withRateLimit(() => blotato.getPostStatus(id)));
    const index = buildNecLinkIndex(resolved);

    // 2. Blotato numeric post id -> URL (GET /v2/posts?status=published, paginated).
    const urlByPostId = new Map<string, string>();
    let cursor: string | undefined;
    let publishedWithoutUrl = 0; // counted, printed in the plan
    do {
        const res = await withRateLimit(() => blotato.listPublishedPosts(POSTS_SINCE, cursor));
        for (const p of res.items ?? []) {
            if (p.state?.postUrl) urlByPostId.set(String(p.id), p.state.postUrl);
            else publishedWithoutUrl++;
        }
        cursor = res.cursor;
    } while (cursor);

    // 3. performance_metrics rows for the account (read only).
    const supabase = createAdminClient();
    const rows: MetricRow[] = [];
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from('performance_metrics')
            .select('*')
            .eq('platform', 'tiktok')
            .eq('handle', NEC_TIKTOK_HANDLE)
            .order('id')
            .range(from, from + PAGE - 1);
        if (error) throw new Error(`performance_metrics read failed: ${error.message}`);
        rows.push(...((data ?? []) as MetricRow[]));
        if (!data || data.length < PAGE) break;
    }

    const { posts, changes } = planLinks(rows, urlByPostId, index);
    const changeIds = new Set(changes.map((c) => c.id));
    const backup = rows.filter((r) => changeIds.has(r.id));
    const count = (s: NecLinkResult['status']) => posts.filter((p) => p.result.status === s).length;
    const plan = {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : 'dry-run',
        ledgerPath,
        ledgerClips: clips.length,
        ledgerClipsWithSubmission: clips.filter((c) => c.submissionId).length,
        ledgerClipsResolved: resolved.filter((c) => c.publicUrl).length,
        resolveErrors,
        blotatoPublishedPostsWithUrl: urlByPostId.size,
        blotatoPublishedPostsWithoutUrl: publishedWithoutUrl,
        rowsRead: rows.length,
        posts: posts.length,
        postsLinked: count('linked'),
        postsUnlinked: count('unlinked'),
        postsRefused: count('refused'),
        rowsToChange: changes.length,
        rowsGettingPieceKey: changes.filter((c) => c.piece_key).length,
        rowsGettingVideoId: changes.filter((c) => c.video_id).length,
        changes,
        postResults: posts,
        clips: resolved,
    };
    fs.writeFileSync(path.join(out, BACKUP_FILE), JSON.stringify(backup, null, 1));
    fs.writeFileSync(path.join(out, PLAN_FILE), JSON.stringify(plan, null, 1));
    console.log(JSON.stringify({ ...plan, changes: undefined, postResults: undefined, clips: undefined }, null, 1));

    if (!apply) return;
    const done = await applyLinkChanges(supabase as unknown as UpdateClient, changes);
    const keyTargets = changes.filter((c) => c.piece_key).length;
    const videoTargets = changes.filter((c) => c.video_id).length;
    console.log(`applied: piece_key on ${done.pieceKeys} of ${keyTargets} rows, video_id on ${done.videoIds} of ${videoTargets} rows`);
}

const invokedDirectly = (() => {
    const entry = process.argv[1];
    if (!entry) return false;
    try {
        return import.meta.url.toLowerCase() === pathToFileURL(path.resolve(entry)).href.toLowerCase();
    } catch {
        return false;
    }
})();
if (invokedDirectly) {
    main().catch((e) => { console.error((e as Error).message); process.exit(1); });
}
