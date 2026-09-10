/**
 * Local YouTube organic-metrics collector — keyless (yt-dlp only; no YouTube
 * API key exists in this stack). Fills the gap the Blotato-based
 * /api/cron/analytics-pull leaves: Blotato only reports posts IT published
 * (~100-post cap) and only 2 of the 4 registered YouTube channels ever appear.
 * This script resolves each blotato_accounts youtube row to its channel, walks
 * the channel's /videos + /shorts tabs, and snapshots organic
 * views/likes/comments into public.performance_metrics.
 *
 * Row shape (mirrors analytics-pull's conventions):
 *   platform         'youtube'
 *   handle           blotato_accounts.handle VERBATIM (YouTube registry handles
 *                    are display names, e.g. "Faith Harmony (SAI)") — the exact
 *                    string backfill_metric_handles writes and
 *                    get_account_performance joins on (ba.handle = l.handle).
 *   content_piece_id via the video-id join against
 *                    content_pieces.published_platforms.youtube.post_url — the
 *                    same URL store analytics-pull lazily resolves and joins
 *                    on — else null (organic/legacy uploads).
 *   blotato_post_id  the YouTube VIDEO ID. analytics-pull puts the platform's
 *                    post id in this column; ours is the video id.
 *                    NOT null by design: get_account_performance (migration
 *                    019) keys each post on
 *                    coalesce(content_piece_id::text, blotato_post_id), and
 *                    DISTINCT ON treats NULLs as EQUAL — null here on
 *                    piece-less rows would collapse every such row into ONE
 *                    "post" and corrupt the winners feedback loop. 11-char
 *                    video ids cannot collide with Blotato's numeric ids.
 *   shares/saves     0 — YouTube does not expose share or save counts publicly
 *                    (yt-dlp has neither), so these stay zero. Engagement
 *                    ranking still gets views/likes/comments.
 *   captured_at      DB default now(), same as analytics-pull.
 *
 * Dedupe (critical — both winner RPCs aggregate latest-snapshot-per-post, so
 * the corruption risk is key fragmentation and same-day double snapshots):
 * analytics-pull itself has NO same-day guard (it is a once-daily cron), so
 * this collector enforces skip-if-exists-today on BOTH identity keys:
 *   1. (platform='youtube', content_piece_id) captured today — this also
 *      covers the Blotato path: its Vercel cron fires 15:00 UTC (11:00 ET),
 *      before our 4:30 PM ET slot, and Blotato's YouTube rows ALWAYS carry a
 *      content_piece_id (its unmatched-accounts path skips YouTube entirely —
 *      YT URLs carry no @handle). So the two collectors never double-write the
 *      same video on the same day.
 *   2. (platform='youtube', handle, blotato_post_id=video id) captured today —
 *      guards re-runs of this script.
 * Re-attribution: if a video was snapshotted piece-less on an earlier day and
 * NOW matches a piece (analytics-pull resolves post_url lazily), the old rows
 * are updated to carry the content_piece_id so one video never counts as two
 * posts in get_account_performance. --commit only.
 *
 * yt-dlp findings this was built against (2026-07): channel /videos tab flat
 * entries carry NO view_count (null) while /shorts tab flat entries DO; flat
 * entries carry no timestamps. Hence: both tabs are enumerated (most content
 * here is Shorts), the two recency-ordered lists are interleaved, and the
 * first --detail (default 15) get a full per-video yt-dlp fetch for
 * views/likes/comments. Beyond that, Shorts snapshot flat-tab views with
 * likes/comments CARRIED FORWARD from the latest prior snapshot that had real
 * engagement (both winner RPCs are latest-snapshot-wins, so a views-only row
 * with likes/comments coerced to 0 would overwrite real engagement and bury
 * the topic in the engagement-weighted ranking); /videos-tab entries beyond
 * the budget are skipped as no-metrics (counted in the summary).
 *
 * Run (dry run — prints the plan, writes nothing):
 *   npx tsx --env-file=.env.local src/scripts/pull-youtube-metrics.ts
 * Commit (inserts performance_metrics snapshots + zero-capture alert file):
 *   npx tsx --env-file=.env.local src/scripts/pull-youtube-metrics.ts --commit
 * Flags:
 *   --per-channel N   cap per channel TAB (videos, shorts), default 50
 *   --detail N        full per-video metric fetches per channel, default 15
 *   --channel <account_id>=<channel_url>   manual override for accounts with
 *                     no resolvable published URL (repeatable)
 *
 * Scheduling (Windows Task Scheduler — this machine runs ET; daily 4:30 PM ET,
 * after the 11:00 ET Vercel analytics-pull so same-day dedupe sees its rows):
 *   schtasks /create /tn "FHContent YouTube Metrics Pull" /sc DAILY /st 16:30 ^
 *     /tr "cmd /c cd /d D:\Projects\fhcontent-creator-v2 && npx tsx --env-file=.env.local src\scripts\pull-youtube-metrics.ts --commit >> logs\youtube-pull.log 2>&1"
 *
 * Writes ONLY performance_metrics (and the local alert file) — never topics or
 * content_pieces. yt-dlp stays script-local: never import this from src/lib
 * (Vercel must never bundle it).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_PER_CHANNEL = 50;
const DEFAULT_DETAIL = 15;
const PIECE_PAGE_SIZE = 1000;
const MAX_PIECE_PAGES = 20;
const ENGAGEMENT_SCAN_LIMIT = 5000;
const RESOLVE_ATTEMPTS = 3;
/** yt-dlp child-process kill timers — execFileSync without a timeout waits
 *  FOREVER, so one hung yt-dlp (throttled response that trickles bytes) would
 *  hang the scheduled task past its next daily trigger with no alert. */
const YTDLP_DETAIL_TIMEOUT_MS = 120_000;
const YTDLP_FLAT_TIMEOUT_MS = 300_000;
const YTDLP_PREFLIGHT_TIMEOUT_MS = 30_000;
const ALERT_FILE =
    'C:/Users/redle.SOULAAN/.claude/projects/C--WINDOWS-system32/memory/operations/youtube-pull-ALERT.md';

// ---------------------------------------------------------------------------
// Pure section — imported by pull-youtube-metrics.spec.ts. No env, no I/O.
// ---------------------------------------------------------------------------

export interface CliOptions {
    commit: boolean;
    perChannel: number;
    detail: number;
    /** account_id -> channel URL manual overrides (--channel id=url). */
    overrides: Map<string, string>;
}

export type ParsedArgs =
    | { ok: true; opts: CliOptions }
    | { ok: false; error: string };

/** Strict flag parsing: unknown flags are an error (a typo'd flag silently
 *  running a default pull would be worse than failing). Pure — no env reads,
 *  no exit — so the usage path is unit-testable. */
export function parseCliArgs(argv: string[]): ParsedArgs {
    const opts: CliOptions = {
        commit: false,
        perChannel: DEFAULT_PER_CHANNEL,
        detail: DEFAULT_DETAIL,
        overrides: new Map(),
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--help' || flag === '-h') return { ok: false, error: 'usage' };
        if (flag === '--commit') { opts.commit = true; continue; }
        if (flag === '--per-channel' || flag === '--detail') {
            const raw = argv[++i];
            const n = parseInt(raw ?? '', 10);
            if (!raw || !Number.isFinite(n) || String(n) !== raw || n < 1 || n > 200) {
                return { ok: false, error: `${flag} requires an integer 1-200, got "${raw ?? ''}"` };
            }
            if (flag === '--per-channel') opts.perChannel = n; else opts.detail = n;
            continue;
        }
        if (flag === '--channel') {
            const raw = argv[++i];
            const eq = raw?.indexOf('=') ?? -1;
            if (!raw || eq <= 0) {
                return { ok: false, error: `--channel requires <account_id>=<channel_url>, got "${raw ?? ''}"` };
            }
            const id = raw.slice(0, eq).trim();
            const url = raw.slice(eq + 1).trim();
            // http(s)-only guard: anything else (notably strings starting with
            // '-') would be parsed by yt-dlp as a flag (argv option injection).
            if (!/^https?:\/\//i.test(url)) {
                return { ok: false, error: `--channel url "${url}" is not an http(s) URL` };
            }
            opts.overrides.set(id, url);
            continue;
        }
        return { ok: false, error: `unknown flag "${flag}"` };
    }
    return { ok: true, opts };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** YouTube video id from any published URL form we store: watch?v=, youtu.be/,
 *  /shorts/, /embed/, /live/. This is the YouTube join key — analytics-pull's
 *  normalizeUrl strips query strings, which would destroy watch?v= ids, so
 *  YouTube joins on video id instead of normalized URL. */
export function extractVideoId(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let u: URL;
    try { u = new URL(raw); } catch { return null; }
    const host = u.hostname.replace(/^(www|m)\./i, '').toLowerCase();
    if (host === 'youtu.be') {
        const id = u.pathname.split('/').filter(Boolean)[0] ?? '';
        return VIDEO_ID.test(id) ? id : null;
    }
    if (host !== 'youtube.com') return null;
    const v = u.searchParams.get('v');
    if (v && VIDEO_ID.test(v)) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,20})(?:\/|$)/);
    return m ? m[1] : null;
}

/** Same-day dedupe key for piece-less rows: platform is fixed 'youtube', so the
 *  key is handle + the video id stored in blotato_post_id (where analytics-pull
 *  keeps its platform post ids). */
export function videoDupKey(handle: string, videoId: string): string {
    return `youtube|${handle}|${videoId}`;
}

export interface MetricRow {
    content_piece_id: string | null;
    platform: 'youtube';
    handle: string;
    blotato_post_id: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
}

/** Coerce yt-dlp metric values (null when hidden/absent) to finite numbers —
 *  mirrors analytics-pull's mapMetrics guard: junk becomes 0, never NaN. */
export function nMetric(v: number | string | null | undefined): number {
    const x = typeof v === 'string' ? Number(v) : v;
    return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

export function toMetricRow(input: {
    videoId: string;
    handle: string;
    pieceId: string | null;
    views: number | null | undefined;
    likes: number | null | undefined;
    comments: number | null | undefined;
}): MetricRow {
    return {
        content_piece_id: input.pieceId,
        platform: 'youtube',
        handle: input.handle,
        blotato_post_id: input.videoId,
        views: nMetric(input.views),
        likes: nMetric(input.likes),
        comments: nMetric(input.comments),
        // YouTube exposes neither share nor save counts publicly — always 0.
        shares: 0,
        saves: 0,
    };
}

export interface PriorEngagement {
    likes: number;
    comments: number;
}

/** Fill likes/comments the flat tabs don't provide (null/undefined = NOT
 *  fetched) from the latest prior snapshot that had real engagement. Both
 *  winner RPCs aggregate latest-snapshot-per-post, so a views-only re-snapshot
 *  of a Short beyond the --detail budget must never zero-overwrite engagement
 *  a detail fetch captured on an earlier day — that would bury the topic in
 *  get_topic_winners' engagement-rate ranking. Fetched values (including a
 *  real 0) are never overridden. */
export function carryForwardEngagement(
    fresh: { likes: number | null | undefined; comments: number | null | undefined },
    prior: PriorEngagement | undefined,
): { likes: number | null | undefined; comments: number | null | undefined; carried: boolean } {
    if (!prior) return { likes: fresh.likes, comments: fresh.comments, carried: false };
    const carried = fresh.likes == null || fresh.comments == null;
    return {
        likes: fresh.likes ?? prior.likes,
        comments: fresh.comments ?? prior.comments,
        carried,
    };
}

/** analytics-pull skips zero-signal rows (matchedNoSignal); mirror it. */
export function hasSignal(row: MetricRow): boolean {
    return row.views + row.likes + row.comments > 0;
}

/** True if a snapshot for this video already exists today — via either
 *  identity key (see header doc). */
export function isDupToday(
    row: MetricRow,
    piecesToday: ReadonlySet<string>,
    videoKeysToday: ReadonlySet<string>,
): boolean {
    if (row.content_piece_id && piecesToday.has(row.content_piece_id)) return true;
    return videoKeysToday.has(videoDupKey(row.handle, row.blotato_post_id));
}

/** Alternate two recency-ordered lists (videos tab / shorts tab carry no
 *  timestamps, so alternation is the best recency merge available). */
export function interleave<T>(a: T[], b: T[]): T[] {
    const out: T[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (i < a.length) out.push(a[i]);
        if (i < b.length) out.push(b[i]);
    }
    return out;
}

export function todayUtcStartIso(now: Date = new Date()): string {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
}

// ---------------------------------------------------------------------------
// End pure section.
// ---------------------------------------------------------------------------

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function usage(): void {
    console.error(`Usage:
  npx tsx --env-file=.env.local src/scripts/pull-youtube-metrics.ts \\
    [--per-channel 50] [--detail 15] \\
    [--channel <account_id>=<channel_url>]... [--commit]

Dry-run by default (resolves channels, enumerates videos, prints the
would-write summary, writes nothing). --commit inserts performance_metrics
snapshots (same-day dupes skipped) and appends the zero-capture alert file
when nothing was captured.`);
}

interface FlatEntry {
    id: string;
    title?: string;
    url?: string;
    view_count?: number | null;
}

interface DetailMeta {
    id: string;
    view_count?: number | null;
    like_count?: number | null;
    comment_count?: number | null;
    channel?: string;
    channel_id?: string;
    channel_url?: string;
}

/** yt-dlp failure logger. A bare swallow here made a missing binary (spawn
 *  ENOENT) indistinguishable from a dead channel — the operator was misdirected
 *  to --channel overrides that cannot help. stderr stays suppressed (stdio
 *  ignore — yt-dlp's per-call version warning would bloat the daily log), but
 *  the spawn/exit exception itself is always surfaced. */
function warnYtDlpFailure(context: string, e: unknown): void {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') {
        console.error(`[ERR] yt-dlp not found on PATH (${context}) — install yt-dlp or fix the scheduled task's PATH`);
    } else if (code === 'ETIMEDOUT') {
        console.warn(`[WARN] yt-dlp hung past its timeout and was killed (${context})`);
    } else {
        console.warn(`[WARN] yt-dlp failed (${context}): ${errMsg(e)}`);
    }
}

/** Fail fast when yt-dlp can't even print --version (classically: missing from
 *  the scheduled task's leaner PATH). Without this every call fails null and
 *  the run ends in misleading channel-resolution warnings. */
function ytPreflight(): { ok: true; version: string } | { ok: false; error: string } {
    try {
        const out = execFileSync('yt-dlp', ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: YTDLP_PREFLIGHT_TIMEOUT_MS,
            killSignal: 'SIGKILL',
        });
        return { ok: true, version: out.trim() };
    } catch (e) {
        const code = (e as NodeJS.ErrnoException | null)?.code;
        return {
            ok: false,
            error: code === 'ENOENT'
                ? "yt-dlp not found on PATH — install yt-dlp or fix the scheduled task's PATH"
                : `yt-dlp --version failed: ${errMsg(e)}`,
        };
    }
}

/** yt-dlp full metadata for one URL — no download. Null (caller warns) on
 *  failure; the failure itself is logged with its cause (see warnYtDlpFailure). */
function ytDumpJson(url: string): DetailMeta | null {
    try {
        const out = execFileSync('yt-dlp', ['--dump-json', '--skip-download', url], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: YTDLP_DETAIL_TIMEOUT_MS,
            killSignal: 'SIGKILL',
        });
        return JSON.parse(out) as DetailMeta;
    } catch (e) {
        warnYtDlpFailure(`--dump-json ${url}`, e);
        return null;
    }
}

/** Flat-playlist enumeration of one channel tab. Null on failure (e.g. the
 *  channel has no /shorts tab — yt-dlp errors on missing tabs). */
function ytFlatTab(channelUrl: string, tab: 'videos' | 'shorts', cap: number): FlatEntry[] | null {
    const url = `${channelUrl.replace(/\/+$/, '')}/${tab}`;
    try {
        const out = execFileSync(
            'yt-dlp',
            ['--flat-playlist', '--dump-json', '--playlist-end', String(cap), url],
            {
                encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024,
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: YTDLP_FLAT_TIMEOUT_MS,
                killSignal: 'SIGKILL',
            },
        );
        return out
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line) as FlatEntry)
            .filter((e) => typeof e.id === 'string' && VIDEO_ID.test(e.id));
    } catch (e) {
        warnYtDlpFailure(`--flat-playlist ${url}`, e);
        return null;
    }
}

interface AccountRow {
    account_id: string;
    handle: string;
    brand: string;
}

interface ChannelResolution {
    channelUrl: string;
    channelId: string | null;
    channelName: string | null;
    via: 'override' | string; // override or the video id that resolved it
}

interface ChannelSummary {
    account: AccountRow;
    resolution: ChannelResolution;
    seen: number;
    videosTab: number;
    shortsTab: number;
    matched: number;
    written: number;
    dupSkipped: number;
    noSignal: number;
    noMetrics: number;
    detailErrors: number;
    insertErrors: number;
    healed: number;
    carried: number;
}

async function main() {
    // Arg validation FIRST — usage/bad-flag paths must not touch env or network.
    const parsed = parseCliArgs(process.argv.slice(2));
    if (!parsed.ok) {
        if (parsed.error !== 'usage') console.error(`[ERR] ${parsed.error}`);
        usage();
        process.exit(1);
    }
    const { commit, perChannel, detail, overrides } = parsed.opts;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!supabaseUrl || !serviceKey) {
        console.error('[ERR] Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local');
        process.exit(1);
    }
    const sb = createClient(supabaseUrl, serviceKey);

    // yt-dlp preflight BEFORE any network work — a missing binary must be a
    // clear fatal, not a cascade of channel-resolution warnings.
    const preflight = ytPreflight();
    if (!preflight.ok) {
        console.error(`[ERR] ${preflight.error}`);
        process.exit(1);
    }

    console.log(`\n${commit ? '=== COMMIT ===' : '=== DRY RUN (no writes) ==='}`);
    console.log(`yt-dlp ${preflight.version}`);
    console.log(`per-channel tab cap ${perChannel}, detail fetches ${detail}/channel\n`);

    // 1. YouTube rows from the account registry.
    const { data: acctData, error: acctErr } = await sb
        .from('blotato_accounts')
        .select('account_id, handle, brand')
        .eq('platform', 'youtube');
    if (acctErr || !acctData || acctData.length === 0) {
        console.error(`[ERR] blotato_accounts youtube query failed or empty: ${acctErr?.message ?? 'no rows'}`);
        process.exit(1);
    }
    const accounts = acctData as AccountRow[];
    console.log(`[ok] ${accounts.length} registered YouTube account(s): ${accounts.map((a) => `${a.account_id} "${a.handle}"`).join(', ')}`);

    // 2. Attribution data: personas map each account to its content, and the
    //    published_platforms.youtube.post_url store (the same URL join
    //    analytics-pull uses) yields both (a) recent URLs to resolve each
    //    account's channel from and (b) the video-id -> content_piece join.
    //    The JOIN must cover EVERY published piece — analytics-pull scans all
    //    published pieces with no persona filter, so any piece it can attribute
    //    but this scan misses would be snapshotted piece-less here, splitting
    //    one video across two coalesce keys in get_account_performance
    //    (double-counted, and the re-attribution heal can never fire). Hence:
    //    no persona filter, paged past any row cap, server-side filtered to
    //    pieces that actually have a youtube post_url. Persona mappings are
    //    used ONLY for channel resolution (recent URLs), never to gate the join.
    const { data: personaData, error: personaErr } = await sb
        .from('personas')
        .select('id, name, platform_accounts');
    if (personaErr) {
        console.error(`[ERR] personas query failed: ${personaErr.message}`);
        process.exit(1);
    }
    const personaToAccount = new Map<string, string>();
    for (const p of (personaData ?? []) as Array<{ id: string; platform_accounts: Record<string, string> | null }>) {
        const acct = p.platform_accounts?.youtube;
        if (typeof acct === 'string' && acct) personaToAccount.set(p.id, acct);
    }

    interface PieceRow {
        id: string;
        published_platforms: { youtube?: { status?: string; post_url?: string } } | null;
        topics: { persona_id: string } | null;
    }
    const pieces: PieceRow[] = [];
    for (let page = 0; page < MAX_PIECE_PAGES; page++) {
        const from = page * PIECE_PAGE_SIZE;
        const { data: pieceData, error: pieceErr } = await sb
            .from('content_pieces')
            .select('id, published_platforms, topics(persona_id)')
            .eq('status', 'published')
            .not('published_platforms->youtube->>post_url', 'is', null)
            .order('published_at', { ascending: false })
            .order('id', { ascending: true }) // stable page order on published_at ties
            .range(from, from + PIECE_PAGE_SIZE - 1);
        if (pieceErr) {
            console.error(`[ERR] content_pieces query failed (page ${page}): ${pieceErr.message}`);
            process.exit(1);
        }
        const batch = (pieceData ?? []) as unknown as PieceRow[];
        pieces.push(...batch);
        if (batch.length < PIECE_PAGE_SIZE) break;
        if (page === MAX_PIECE_PAGES - 1) {
            console.warn(`[WARN] piece scan hit the ${MAX_PIECE_PAGES * PIECE_PAGE_SIZE}-row safety cap — oldest YouTube pieces may be unjoined`);
        }
    }

    const videoToPiece = new Map<string, string>();       // video id -> content_piece_id (first = most recent wins)
    const accountRecentUrls = new Map<string, string[]>(); // account_id -> recent published YT URLs
    for (const piece of pieces) {
        const yt = piece.published_platforms?.youtube;
        if (!yt || yt.status !== 'published' || !yt.post_url) continue;
        const videoId = extractVideoId(yt.post_url);
        if (!videoId) continue;
        if (!videoToPiece.has(videoId)) videoToPiece.set(videoId, piece.id);
        const acct = piece.topics ? personaToAccount.get(piece.topics.persona_id) : undefined;
        if (acct) {
            const urls = accountRecentUrls.get(acct) ?? [];
            if (urls.length < RESOLVE_ATTEMPTS) { urls.push(yt.post_url); accountRecentUrls.set(acct, urls); }
        }
    }
    console.log(`[ok] ${pieces.length} published piece(s) scanned, ${videoToPiece.size} joinable YouTube video id(s)`);

    // 3. Resolve each account to a channel URL (override first, else yt-dlp on
    //    a recent published video). Cached per run in `resolutions`.
    const resolutions = new Map<string, ChannelResolution>();
    const unresolved: AccountRow[] = [];
    const claimedChannels = new Map<string, string>(); // channel key -> account_id
    for (const account of accounts) {
        const override = overrides.get(account.account_id);
        if (override) {
            resolutions.set(account.account_id, { channelUrl: override, channelId: null, channelName: null, via: 'override' });
            console.log(`[ok] ${account.account_id} "${account.handle}" -> ${override} (manual --channel override)`);
            continue;
        }
        const urls = accountRecentUrls.get(account.account_id) ?? [];
        let resolution: ChannelResolution | null = null;
        for (const url of urls) {
            const meta = ytDumpJson(url);
            if (meta?.channel_url) {
                resolution = {
                    channelUrl: meta.channel_url,
                    channelId: meta.channel_id ?? null,
                    channelName: meta.channel ?? null,
                    via: meta.id,
                };
                break;
            }
            console.warn(`[WARN] channel resolution attempt failed for ${account.account_id} via ${url}`);
        }
        if (!resolution) {
            unresolved.push(account);
            console.warn(`[WARN] ${account.account_id} "${account.handle}": no resolvable published YouTube URL — pass --channel ${account.account_id}=<channel_url>`);
            continue;
        }
        const key = resolution.channelId ?? resolution.channelUrl;
        const claimedBy = claimedChannels.get(key);
        if (claimedBy) {
            // Two registry rows on one channel would double-write every video
            // under two handles — keep the first claim only.
            console.warn(`[WARN] ${account.account_id} resolves to the same channel as account ${claimedBy} — skipping to avoid double-writes`);
            unresolved.push(account);
            continue;
        }
        claimedChannels.set(key, account.account_id);
        resolutions.set(account.account_id, resolution);
        console.log(`[ok] ${account.account_id} "${account.handle}" -> ${resolution.channelUrl} ("${resolution.channelName ?? '?'}")`);
    }

    // 4. Same-day dedupe sets from today's stored snapshots (both collectors).
    const { data: todayRows, error: todayErr } = await sb
        .from('performance_metrics')
        .select('content_piece_id, blotato_post_id, handle')
        .eq('platform', 'youtube')
        .gte('captured_at', todayUtcStartIso());
    if (todayErr) {
        console.error(`[ERR] today's performance_metrics query failed: ${todayErr.message} — refusing to write without dedupe data`);
        process.exit(1);
    }
    const piecesToday = new Set<string>();
    const videoKeysToday = new Set<string>();
    for (const r of (todayRows ?? []) as Array<{ content_piece_id: string | null; blotato_post_id: string | null; handle: string | null }>) {
        if (r.content_piece_id) piecesToday.add(r.content_piece_id);
        if (r.handle && r.blotato_post_id) videoKeysToday.add(videoDupKey(r.handle, r.blotato_post_id));
    }
    console.log(`[ok] ${(todayRows ?? []).length} youtube snapshot(s) already captured today (dedupe baseline)\n`);

    // Historic piece-less rows, for re-attribution when a video now matches.
    const { data: orphanRows } = await sb
        .from('performance_metrics')
        .select('blotato_post_id')
        .eq('platform', 'youtube')
        .is('content_piece_id', null)
        .not('blotato_post_id', 'is', null);
    const orphanVideoIds = new Set(
        ((orphanRows ?? []) as Array<{ blotato_post_id: string }>).map((r) => r.blotato_post_id),
    );

    // Latest known REAL engagement per video id — the carry-forward source for
    // Shorts beyond the --detail budget (see carryForwardEngagement). Newest
    // first + first-wins = latest positive engagement; zeroed views-only rows
    // are excluded by the or-filter so they can never poison the baseline.
    const { data: engData, error: engErr } = await sb
        .from('performance_metrics')
        .select('blotato_post_id, likes, comments')
        .eq('platform', 'youtube')
        .not('blotato_post_id', 'is', null)
        .or('likes.gt.0,comments.gt.0')
        .order('captured_at', { ascending: false })
        .limit(ENGAGEMENT_SCAN_LIMIT);
    if (engErr) {
        console.error(`[ERR] prior-engagement query failed: ${engErr.message} — refusing to write snapshots that could zero-overwrite engagement`);
        process.exit(1);
    }
    const priorEngagement = new Map<string, PriorEngagement>();
    for (const r of (engData ?? []) as Array<{ blotato_post_id: string; likes: number | null; comments: number | null }>) {
        if (!priorEngagement.has(r.blotato_post_id)) {
            priorEngagement.set(r.blotato_post_id, { likes: nMetric(r.likes), comments: nMetric(r.comments) });
        }
    }
    console.log(`[ok] ${priorEngagement.size} video(s) with prior engagement (carry-forward baseline)`);

    // 5. Per channel: enumerate, detail-fetch, map, dedupe, write.
    const summaries: ChannelSummary[] = [];
    for (const account of accounts) {
        const resolution = resolutions.get(account.account_id);
        if (!resolution) continue;
        const s: ChannelSummary = {
            account, resolution,
            seen: 0, videosTab: 0, shortsTab: 0, matched: 0, written: 0,
            dupSkipped: 0, noSignal: 0, noMetrics: 0, detailErrors: 0, insertErrors: 0, healed: 0, carried: 0,
        };
        summaries.push(s);
        console.log(`--- ${account.handle} (${account.account_id}) ---`);

        const videosTab = ytFlatTab(resolution.channelUrl, 'videos', perChannel);
        const shortsTab = ytFlatTab(resolution.channelUrl, 'shorts', perChannel);
        if (videosTab === null) console.warn(`[WARN] /videos tab enumeration failed (tab may not exist)`);
        if (shortsTab === null) console.warn(`[WARN] /shorts tab enumeration failed (tab may not exist)`);
        s.videosTab = videosTab?.length ?? 0;
        s.shortsTab = shortsTab?.length ?? 0;

        // Interleave the two recency-ordered tabs, unique by video id.
        const merged: FlatEntry[] = [];
        const seenIds = new Set<string>();
        for (const entry of interleave(videosTab ?? [], shortsTab ?? [])) {
            if (seenIds.has(entry.id)) continue;
            seenIds.add(entry.id);
            merged.push(entry);
        }
        s.seen = merged.length;
        console.log(`[ok] ${merged.length} video(s) seen (${s.videosTab} videos-tab + ${s.shortsTab} shorts-tab)`);

        for (let i = 0; i < merged.length; i++) {
            const entry = merged[i];
            let views: number | null | undefined = entry.view_count;
            let likes: number | null | undefined = null;
            let comments: number | null | undefined = null;
            let hasAnyMetric = typeof entry.view_count === 'number';

            if (i < detail) {
                // Full per-video fetch for the most recent N (sequential; a
                // single failure degrades to flat data with a warning).
                const meta = ytDumpJson(`https://www.youtube.com/watch?v=${entry.id}`);
                if (meta) {
                    views = meta.view_count ?? views;
                    likes = meta.like_count;
                    comments = meta.comment_count;
                    hasAnyMetric = true;
                } else {
                    s.detailErrors++;
                    console.warn(`[WARN] detail fetch failed for ${entry.id} — falling back to flat data`);
                }
            }

            if (!hasAnyMetric) {
                // /videos-tab flat entries carry no view_count and this one is
                // beyond the detail budget — nothing real to snapshot.
                s.noMetrics++;
                continue;
            }

            // Unfetched likes/comments (beyond the detail budget, or hidden in
            // a detail fetch) inherit the latest prior REAL engagement — a
            // views-only snapshot must never zero-overwrite engagement in the
            // latest-snapshot-wins winners RPCs.
            if (likes == null || comments == null) {
                const cf = carryForwardEngagement({ likes, comments }, priorEngagement.get(entry.id));
                if (cf.carried) {
                    likes = cf.likes;
                    comments = cf.comments;
                    s.carried++;
                }
            }

            const pieceId = videoToPiece.get(entry.id) ?? null;
            if (pieceId) s.matched++;
            const row = toMetricRow({
                videoId: entry.id,
                handle: account.handle,
                pieceId,
                views, likes, comments,
            });

            // Re-attribution: this video has historic piece-less snapshots and
            // now matches a piece — heal the old rows so the video keeps ONE
            // aggregation key in get_account_performance.
            //
            // This MUST run BEFORE the same-day dedupe gate. Healing concerns
            // historic rows, not today's snapshot, but while it sat after the
            // gate any video already captured today `continue`d straight past
            // it — so a video snapshotted piece-less in the morning and matched
            // to a piece later the same day stayed orphaned permanently. That
            // is how the 2026-07-24..26 orphan rows accumulated. The update
            // filters on `content_piece_id is null`, so it is idempotent and
            // safe to attempt on every pass.
            if (pieceId && orphanVideoIds.has(entry.id)) {
                if (commit) {
                    const { error: healErr } = await sb
                        .from('performance_metrics')
                        .update({ content_piece_id: pieceId })
                        .eq('platform', 'youtube')
                        .eq('blotato_post_id', entry.id)
                        .is('content_piece_id', null);
                    if (healErr) console.warn(`[WARN] re-attribution failed for ${entry.id}: ${healErr.message}`);
                    else s.healed++;
                } else {
                    s.healed++; // would-heal in dry run
                }
                orphanVideoIds.delete(entry.id);
            }

            if (!hasSignal(row)) { s.noSignal++; continue; }
            if (isDupToday(row, piecesToday, videoKeysToday)) {
                s.dupSkipped++;
                continue;
            }

            if (commit) {
                const { error: insertErr } = await sb.from('performance_metrics').insert(row);
                if (insertErr) {
                    s.insertErrors++;
                    console.error(`[ERR] insert failed for ${entry.id}: ${insertErr.message}`);
                    continue;
                }
            }
            s.written++;
            // Mark as captured so a video appearing on both tabs (or twice in
            // the run) cannot double-write.
            videoKeysToday.add(videoDupKey(row.handle, row.blotato_post_id));
            if (row.content_piece_id) piecesToday.add(row.content_piece_id);
            console.log(`[ok] ${entry.id}  views=${row.views} likes=${row.likes} comments=${row.comments}  piece=${pieceId ? 'matched' : 'none'}  "${(entry.title ?? '').slice(0, 50)}"`);
        }
    }

    // 6. Summary + zero-capture alert.
    const totalWritten = summaries.reduce((n, s) => n + s.written, 0);
    const totalDup = summaries.reduce((n, s) => n + s.dupSkipped, 0);
    const totalSeen = summaries.reduce((n, s) => n + s.seen, 0);

    console.log('\n===== SUMMARY =====');
    console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN (no writes)'}`);
    for (const s of summaries) {
        console.log(
            `${s.account.handle} (${s.account.account_id}): seen ${s.seen} (videos ${s.videosTab} / shorts ${s.shortsTab}) | ` +
            `matched-to-piece ${s.matched} | ${commit ? 'written' : 'would-write'} ${s.written} | dup-skipped ${s.dupSkipped} | ` +
            `no-signal ${s.noSignal} | no-metrics ${s.noMetrics} | detail-errors ${s.detailErrors} | insert-errors ${s.insertErrors} | healed ${s.healed} | eng-carried ${s.carried}`,
        );
    }
    if (unresolved.length > 0) {
        console.log(`Unresolved account(s): ${unresolved.map((a) => `${a.account_id} "${a.handle}"`).join(', ')}`);
        console.log(`  -> re-run with ${unresolved.map((a) => `--channel ${a.account_id}=<channel_url>`).join(' ')}`);
    }
    console.log(`Total snapshots ${commit ? 'written' : 'planned'}: ${totalWritten} (dup-skipped ${totalDup}, seen ${totalSeen})`);

    if (commit && totalWritten === 0 && totalDup > 0) {
        // Healthy second run: everything already captured today. Not an alert.
        console.log(`All ${totalDup} candidate snapshot(s) were same-day duplicates — today's capture already exists, no alert.`);
    } else if (commit && totalWritten === 0) {
        const reason =
            summaries.length === 0
                ? `no account resolved to a channel (${unresolved.length} unresolved — see --channel override)`
                : totalSeen === 0
                    ? 'channels resolved but 0 videos enumerated (yt-dlp tab failures?)'
                    : 'videos enumerated but none produced a writable snapshot (all no-signal/no-metrics/insert-errors)';
        mkdirSync(path.dirname(ALERT_FILE), { recursive: true });
        const header = existsSync(ALERT_FILE)
            ? ''
            : '# YouTube pull alerts\n\nAppended by fhcontent-creator-v2 src/scripts/pull-youtube-metrics.ts when a --commit run captures 0 snapshots.\n';
        appendFileSync(ALERT_FILE, `${header}\n## ${new Date().toISOString()} - 0 snapshots captured\n- reason: ${reason}\n`);
        console.error(`[WARN] ZERO snapshots captured — alert appended to ${ALERT_FILE}`);
    }
    if (!commit) console.log('Re-run with --commit to write performance_metrics snapshots.');
}

// Guard: run only when invoked directly (npx tsx ...), never on spec import.
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
    main().catch((e) => { console.error(errMsg(e)); process.exit(1); });
}
