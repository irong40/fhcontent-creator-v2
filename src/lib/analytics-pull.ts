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

/** Canonicalise a post URL so the two id spaces join reliably: drop protocol,
 *  a leading www., any query/hash, and a trailing slash; lowercase the host. */
export function normalizeUrl(raw: string | null | undefined): string {
    if (!raw) return '';
    try {
        const u = new URL(raw);
        const host = u.host.replace(/^www\./, '').toLowerCase();
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
    matchedNoSignal: number;
    unmatched: number;
    insertErrors: number;
    alerted: boolean;
    sampleInsertError?: string;
    sampleUnmatchedUrl?: string;
    error?: string;
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
        matchedNoSignal: 0,
        unmatched: 0,
        insertErrors: 0,
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

    const result: AnalyticsPullResult = { ...empty, message: 'Analytics pull complete', pieces_scanned: pieces.length };

    // -- Step 1: lazily resolve missing post_url for published platform entries
    let resolutionsLeft = MAX_URL_RESOLUTIONS_PER_RUN;
    for (const piece of pieces as PieceRow[]) {
        const platforms = piece.published_platforms;
        if (!platforms) continue;

        let dirty = false;
        for (const entry of Object.values(platforms) as Array<PlatformStatus | undefined>) {
            if (!entry || entry.status !== 'published' || !entry.post_id || entry.post_url) continue;
            if (resolutionsLeft <= 0) break;
            resolutionsLeft--;
            try {
                const status = await blotato.getPostStatus(entry.post_id);
                const url = (status as unknown as Record<string, unknown>).publicUrl
                    ?? (status as unknown as Record<string, unknown>).postUrl;
                if (typeof url === 'string' && url.length > 0) {
                    entry.post_url = url;
                    dirty = true;
                    result.urlsResolved++;
                }
            } catch {
                result.urlResolutionErrors++;
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

    // -- Step 2: pull posts-with-metrics from GET /v2/analytics, unioned across
    // sort keys, and index the latest metrics by normalized post URL.
    const metricsByUrl = new Map<string, BlotatoMetrics>();
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
            if (key && metrics) metricsByUrl.set(key, metrics);
        }
        await sleep(150);
    }
    result.analyticsItems = metricsByUrl.size;

    // -- Step 3: match each published platform entry to its metrics, snapshot.
    for (const piece of pieces as PieceRow[]) {
        const platforms = piece.published_platforms;
        if (!platforms) continue;

        for (const [platform, entry] of Object.entries(platforms) as Array<[string, PlatformStatus | undefined]>) {
            if (!entry || entry.status !== 'published' || !entry.post_url) continue;
            const metrics = metricsByUrl.get(normalizeUrl(entry.post_url));
            if (!metrics) {
                result.unmatched++;
                if (!result.sampleUnmatchedUrl) result.sampleUnmatchedUrl = entry.post_url;
                continue;
            }
            const mapped = mapMetrics(metrics);
            const hasSignal = mapped.views + mapped.likes + mapped.comments + mapped.shares + mapped.saves > 0;
            if (!hasSignal) { result.matchedNoSignal++; continue; }

            const { error: insertError } = await supabase.from('performance_metrics').insert({
                content_piece_id: piece.id,
                platform,
                ...mapped,
            });
            if (insertError) {
                result.insertErrors++;
                if (!result.sampleInsertError) result.sampleInsertError = insertError.message;
            } else {
                result.snapshots++;
            }
        }
    }

    // -- A zero-row "success" is invisible to failure alerts. Surface it: if we
    // scanned pieces but stored nothing, something upstream is broken.
    if (result.pieces_scanned > 0 && result.snapshots === 0) {
        result.alerted = true;
        const detail =
            `scanned ${result.pieces_scanned}, analyticsItems ${result.analyticsItems}, ` +
            `unmatched ${result.unmatched}, matchedNoSignal ${result.matchedNoSignal}, ` +
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
