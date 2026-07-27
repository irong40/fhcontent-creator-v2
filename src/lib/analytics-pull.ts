import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { notifyError } from '@/lib/notifications';
import type {
    PublishedPlatforms,
    PlatformStatus,
} from '@/types/database';
import type {
    BlotatoMetrics,
    BlotatoAnalyticsListItem,
    BlotatoAnalyticsSortBy,
} from '@/lib/blotato';

/**
 * Shared analytics collector. Snapshots engagement metrics for recently
 * published content pieces into performance_metrics.
 *
 * Invoked by the daily cron (GET /api/cron/analytics-pull) and the
 * dashboard's manual trigger (POST /api/analytics/pull).
 *
 * Blotato has two id spaces: POST /posts returns a submission UUID (what we
 * store in published_platforms.post_id), while analytics keys on the numeric
 * published-post id. The join between them is the live post URL:
 * getPostStatus(submissionId) → publicUrl, and each analytics item carries a
 * postUrl. Resolved URLs are cached in published_platforms.post_url so each
 * submission is only resolved once.
 *
 * Engagement is read from GET /v2/analytics (listTopPosts), which returns the
 * latest metrics INLINE. The older per-post GET /posts/{id}/analytics endpoint
 * returns an empty `metrics: {}` (or 404) for many posts that plainly have
 * metrics here, which is why every prior run produced zero snapshots.
 */

const LOOKBACK_DAYS = 60;
/** Bound Blotato calls per run so the route stays well inside function limits. */
const MAX_URL_RESOLUTIONS_PER_RUN = 80;
/** GET /v2/analytics is capped at 100 and has no cursor, so union several sort
 *  keys to widen coverage beyond a single top-100-by-views slice. */
const ANALYTICS_SORT_KEYS: BlotatoAnalyticsSortBy[] = [
    'views_count',
    'likes_count',
    'comments_count',
    'reach_count',
];
const ANALYTICS_PAGE_LIMIT = 100;

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

const YT_VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** YouTube is the one platform that keeps its post identity in the QUERY STRING
 *  (watch?v=<id>), which the generic path-only normalization below discards —
 *  collapsing every watch URL onto the single key `youtube.com/watch`. That is
 *  not a near-miss: the analytics index is a Map, so one arbitrary YouTube post
 *  won the key and its metrics were then attributed to EVERY YouTube piece in
 *  the run (on 2026-07-26 all 11 SAI shorts stored Blotato post 5321272's
 *  3 views). Canonicalise YouTube to its video id so each video keys uniquely.
 *
 *  Twin of extractVideoId() in src/scripts/pull-youtube-metrics.ts — kept
 *  separate on purpose: that script is yt-dlp-bound and must never be importable
 *  from src/lib (Vercel would bundle it). Keep the two in sync. */
export function youtubeVideoKey(host: string, u: URL): string | null {
    if (host === 'youtu.be') {
        const id = u.pathname.split('/').filter(Boolean)[0] ?? '';
        return YT_VIDEO_ID.test(id) ? id : null;
    }
    if (host !== 'youtube.com' && host !== 'm.youtube.com') return null;
    const v = u.searchParams.get('v');
    if (v && YT_VIDEO_ID.test(v)) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{6,20})(?:\/|$)/);
    return m ? m[1] : null;
}

/** Canonicalise a post URL so the two id spaces join reliably: drop protocol,
 *  a leading www., any query/hash, and a trailing slash; lowercase the host.
 *  YouTube is special-cased to its video id (see youtubeVideoKey) because its
 *  identity lives in the query string this otherwise throws away. */
export function normalizeUrl(raw: string | null | undefined): string {
    if (!raw) return '';
    try {
        const u = new URL(raw);
        const host = u.host.replace(/^www\./, '').toLowerCase();
        const ytId = youtubeVideoKey(host, u);
        if (ytId) return `youtube.com/video/${ytId}`;
        const path = u.pathname.replace(/\/+$/, '');
        return `${host}${path}`;
    } catch {
        return raw
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split(/[?#]/)[0]
            .replace(/\/+$/, '')
            .toLowerCase();
    }
}

/** Pull the account @handle out of a post URL, normalized to match the
 *  blotato_accounts registry (leading @, lowercase). Only handle-bearing
 *  platforms (tiktok/threads/twitter) — YouTube/IG/FB URLs carry no handle. */
export function handleFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const at = url.match(/(?:tiktok\.com|threads\.net)\/@([^/?#]+)/i);
    if (at) return `@${at[1].toLowerCase()}`;
    const tw = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status/i);
    if (tw) return `@${tw[1].toLowerCase()}`;
    return null;
}

/** Collapse Blotato's wide metric set onto our performance_metrics columns.
 *  Values arrive as STRINGS (e.g. "1049"); coerce every one. Views may arrive
 *  as viewsCount (YT/TT), playsCount (IG reels) or impressionsCount
 *  (Twitter/Threads). */
export function mapMetrics(m: BlotatoMetrics) {
    const n = (v: number | string | null | undefined) => {
        const x = typeof v === 'string' ? Number(v) : v;
        return typeof x === 'number' && Number.isFinite(x) ? x : 0;
    };
    const shares =
        n(m.sharesCount) +
        n(m.twitterRetweetsCount) + n(m.twitterQuotesCount) +
        n(m.threadsRepostsCount) + n(m.threadsQuotesCount) +
        n(m.blueskyRepostsCount) + n(m.blueskyQuotesCount);
    return {
        views: n(m.viewsCount) || n(m.playsCount) || n(m.impressionsCount) || n(m.reachCount),
        likes: n(m.likesCount),
        comments: n(m.commentsCount) || n(m.repliesCount),
        shares,
        saves: n(m.savesCount),
    };
}

interface PieceRow {
    id: string;
    published_platforms: PublishedPlatforms | null;
}

export interface AnalyticsPullResult {
    message: string;
    window_days: number;
    pieces_scanned: number;
    urlsResolved: number;
    urlResolutionErrors: number;
    analyticsItems: number;
    snapshots: number;
    capturedAccounts: number;
    matchedNoSignal: number;
    unmatched: number;
    insertErrors: number;
    /** YouTube entries deliberately left to the yt-dlp collector. */
    youtubeSkipped: number;
    alerted: boolean;
    sampleInsertError?: string;
    sampleUnmatchedUrl?: string;
    error?: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/** Step 1: resolve and cache the live post URL for published platform entries
 *  that lack one, bounded per run. Mutates each piece's published_platforms in
 *  place and persists the ones that changed. */
export async function resolvePostUrls(
    supabase: AdminClient,
    pieces: PieceRow[],
): Promise<{ urlsResolved: number; urlResolutionErrors: number }> {
    let urlsResolved = 0;
    let urlResolutionErrors = 0;
    let resolutionsLeft = MAX_URL_RESOLUTIONS_PER_RUN;

    for (const piece of pieces) {
        const platforms = piece.published_platforms;
        if (!platforms) continue;

        let dirty = false;
        for (const entry of Object.values(platforms) as Array<PlatformStatus | undefined>) {
            if (!entry || entry.status !== 'published' || !entry.post_id || entry.post_url) continue;
            if (resolutionsLeft <= 0) break;
            resolutionsLeft--;
            try {
                const status = await blotato.getPostStatus(entry.post_id);
                const url = status.publicUrl ?? status.postUrl;
                if (typeof url === 'string' && url.length > 0) {
                    entry.post_url = url;
                    dirty = true;
                    urlsResolved++;
                }
            } catch {
                urlResolutionErrors++;
            }
            await sleep(150);
        }

        if (dirty) {
            await supabase
                .from('content_pieces')
                .update({ published_platforms: platforms })
                .eq('id', piece.id);
        }
    }

    return { urlsResolved, urlResolutionErrors };
}

export interface AnalyticsIndexEntry {
    metrics: BlotatoMetrics;
    platform: string;
    id: string;       // Blotato numeric published-post id
    url: string;      // raw post URL (carries the @handle for some platforms)
}

/** Step 2: pull posts-with-metrics from GET /v2/analytics, unioned across sort
 *  keys, indexed by normalized post URL — keeping platform, Blotato id and the
 *  raw URL so unmatched posts (the separate Sentinel pipeline) can still be
 *  attributed by handle. No DB dependency — unit-tests against a mocked client. */
export async function buildAnalyticsIndex(sinceIso: string): Promise<Map<string, AnalyticsIndexEntry>> {
    const index = new Map<string, AnalyticsIndexEntry>();
    const seenPostIds = new Set<string>();

    for (const sortBy of ANALYTICS_SORT_KEYS) {
        let page: BlotatoAnalyticsListItem[];
        try {
            const res = await blotato.listTopPosts({ sortBy, since: sinceIso, limit: ANALYTICS_PAGE_LIMIT });
            page = res.items ?? [];
        } catch (e) {
            // A single failing sort key shouldn't abort the run; keep going.
            console.error(`[analytics-pull] listTopPosts(${sortBy}) failed:`, (e as Error).message);
            continue;
        }
        for (const item of page) {
            if (seenPostIds.has(item.id)) continue;
            seenPostIds.add(item.id);
            const key = normalizeUrl(item.postUrl);
            const metrics = item.latestMetrics?.metrics;
            if (key && metrics) index.set(key, { metrics, platform: item.platform, id: item.id, url: item.postUrl ?? '' });
        }
        await sleep(150);
    }

    return index;
}

export interface SnapshotResult {
    snapshots: number;
    matchedNoSignal: number;
    unmatched: number;
    insertErrors: number;
    youtubeSkipped: number;
    matchedUrls: Set<string>;
    sampleInsertError?: string;
    sampleUnmatchedUrl?: string;
}

/** YouTube is owned by the keyless yt-dlp collector
 *  (src/scripts/pull-youtube-metrics.ts), NOT by Blotato. Two reasons this must
 *  be a hard skip rather than a preference:
 *
 *  1. Coverage — Blotato reports only posts it published, under a ~100-post cap,
 *     and only 2 of the 4 registered YouTube channels ever appear. yt-dlp walks
 *     each channel's /videos + /shorts tabs (41 videos/day vs Blotato's 11).
 *  2. Ownership conflict — the collector's same-day dedupe treats an existing
 *     (platform='youtube', content_piece_id) row as "already captured today".
 *     Blotato's Vercel cron runs 15:00 UTC, ahead of the collector's 16:30 ET
 *     slot, so every Blotato YouTube row SUPPRESSED that video's real yt-dlp
 *     snapshot. Net effect through 2026-07-26: real per-video numbers were
 *     discarded daily and only piece-less orphan rows survived.
 *
 *  Leaving YouTube out here lets the collector match its videos to pieces and
 *  heal the historic orphans. Do not re-enable without also reworking that
 *  dedupe — see the header of pull-youtube-metrics.ts. */
const BLOTATO_EXCLUDED_PLATFORMS = new Set(['youtube']);

function hasSignal(m: ReturnType<typeof mapMetrics>): boolean {
    return m.views + m.likes + m.comments + m.shares + m.saves > 0;
}

/** Step 3: match each published platform entry to its metrics and insert a
 *  point-in-time snapshot (tagged with the Blotato post id). Returns the set of
 *  matched URLs so unmatched analytics items can be captured separately. */
export async function snapshotMatchedMetrics(
    supabase: AdminClient,
    pieces: PieceRow[],
    index: Map<string, AnalyticsIndexEntry>,
): Promise<SnapshotResult> {
    const out: SnapshotResult = { snapshots: 0, matchedNoSignal: 0, unmatched: 0, insertErrors: 0, youtubeSkipped: 0, matchedUrls: new Set() };

    for (const piece of pieces) {
        const platforms = piece.published_platforms;
        if (!platforms) continue;

        for (const [platform, entry] of Object.entries(platforms) as Array<[string, PlatformStatus | undefined]>) {
            if (!entry || entry.status !== 'published' || !entry.post_url) continue;
            if (BLOTATO_EXCLUDED_PLATFORMS.has(platform)) { out.youtubeSkipped++; continue; }
            const key = normalizeUrl(entry.post_url);
            const hit = index.get(key);
            if (!hit) {
                out.unmatched++;
                if (!out.sampleUnmatchedUrl) out.sampleUnmatchedUrl = entry.post_url;
                continue;
            }
            out.matchedUrls.add(key);
            const mapped = mapMetrics(hit.metrics);
            if (!hasSignal(mapped)) { out.matchedNoSignal++; continue; }

            const { error: insertError } = await supabase.from('performance_metrics').insert({
                content_piece_id: piece.id,
                platform,
                blotato_post_id: hit.id,
                ...mapped,
            });
            if (insertError) {
                out.insertErrors++;
                if (!out.sampleInsertError) out.sampleInsertError = insertError.message;
            } else {
                out.snapshots++;
            }
        }
    }

    return out;
}

/** Step 4: snapshot analytics items that matched no content_piece — the
 *  separate-pipeline accounts (e.g. Sentinel's Part 107 TikTok). Attributed by
 *  the @handle in the URL; handle-less platforms (YouTube/IG/FB) are skipped. */
export async function snapshotUnmatchedAccounts(
    supabase: AdminClient,
    index: Map<string, AnalyticsIndexEntry>,
    matchedUrls: Set<string>,
): Promise<{ capturedAccounts: number; insertErrors: number }> {
    let capturedAccounts = 0;
    let insertErrors = 0;

    for (const [key, hit] of index) {
        if (matchedUrls.has(key)) continue;
        const handle = handleFromUrl(hit.url);
        if (!handle) continue;
        const mapped = mapMetrics(hit.metrics);
        if (!hasSignal(mapped)) continue;

        const { error } = await supabase.from('performance_metrics').insert({
            content_piece_id: null,
            platform: hit.platform,
            handle,
            blotato_post_id: hit.id,
            ...mapped,
        });
        if (error) insertErrors++;
        else capturedAccounts++;
    }

    return { capturedAccounts, insertErrors };
}

export async function runAnalyticsPull(): Promise<{ status: number; body: AnalyticsPullResult }> {
    const supabase = createAdminClient();
    const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const empty: AnalyticsPullResult = {
        message: '',
        window_days: LOOKBACK_DAYS,
        pieces_scanned: 0,
        urlsResolved: 0,
        urlResolutionErrors: 0,
        analyticsItems: 0,
        snapshots: 0,
        capturedAccounts: 0,
        matchedNoSignal: 0,
        unmatched: 0,
        insertErrors: 0,
        youtubeSkipped: 0,
        alerted: false,
    };

    const { data: pieces, error: piecesError } = await supabase
        .from('content_pieces')
        .select('id, published_platforms')
        .eq('status', 'published')
        .gte('published_at', sinceIso);

    if (piecesError) {
        return { status: 500, body: { ...empty, message: 'query failed', error: piecesError.message } };
    }
    if (!pieces || pieces.length === 0) {
        return { status: 200, body: { ...empty, message: 'No published pieces in window' } };
    }

    const rows = pieces as PieceRow[];
    const resolved = await resolvePostUrls(supabase, rows);
    const index = await buildAnalyticsIndex(sinceIso);
    const snap = await snapshotMatchedMetrics(supabase, rows, index);
    const extra = await snapshotUnmatchedAccounts(supabase, index, snap.matchedUrls);

    // Attribute the just-inserted content_piece snapshots to their account
    // (via persona → platform_accounts → blotato_accounts). Non-fatal.
    try {
        await supabase.rpc('backfill_metric_handles');
    } catch (e) {
        console.error('[analytics-pull] backfill_metric_handles failed:', (e as Error).message);
    }

    const result: AnalyticsPullResult = {
        ...empty,
        message: 'Analytics pull complete',
        pieces_scanned: rows.length,
        urlsResolved: resolved.urlsResolved,
        urlResolutionErrors: resolved.urlResolutionErrors,
        analyticsItems: index.size,
        snapshots: snap.snapshots,
        capturedAccounts: extra.capturedAccounts,
        matchedNoSignal: snap.matchedNoSignal,
        unmatched: snap.unmatched,
        youtubeSkipped: snap.youtubeSkipped,
        insertErrors: snap.insertErrors + extra.insertErrors,
        sampleInsertError: snap.sampleInsertError,
        sampleUnmatchedUrl: snap.sampleUnmatchedUrl,
    };

    // -- A zero-row "success" is invisible to failure alerts. Surface it: if we
    // scanned pieces but stored nothing, something upstream is broken.
    // YouTube-only windows are NOT a fault — that platform is deliberately left
    // to the yt-dlp collector, so gate on non-YouTube entries actually seen.
    const nonYoutubeConsidered = snap.snapshots + snap.matchedNoSignal + snap.unmatched;
    if (
        result.pieces_scanned > 0 &&
        result.snapshots === 0 &&
        result.capturedAccounts === 0 &&
        nonYoutubeConsidered > 0
    ) {
        result.alerted = true;
        const detail =
            `scanned ${result.pieces_scanned}, analyticsItems ${result.analyticsItems}, ` +
            `unmatched ${result.unmatched}, matchedNoSignal ${result.matchedNoSignal}, ` +
            `youtubeSkipped ${result.youtubeSkipped}, ` +
            `insertErrors ${result.insertErrors}` +
            (result.sampleInsertError ? ` | insert: ${result.sampleInsertError}` : '') +
            (result.sampleUnmatchedUrl ? ` | unmatched url: ${result.sampleUnmatchedUrl}` : '');
        console.error(`[analytics-pull] ZERO snapshots — ${detail}`);
        await notifyError({
            source: 'analytics-pull',
            message: `Analytics pull stored 0 snapshots (${detail})`,
            severity: 'error',
        }).catch(() => { /* fire-and-forget */ });
    }

    return { status: 200, body: result };
}
