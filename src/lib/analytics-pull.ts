import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import type { PublishedPlatforms, PlatformStatus } from '@/types/database';

/**
 * Shared analytics collector. Pulls engagement metrics from Blotato's
 * analytics API for all recently published content pieces and stores
 * point-in-time snapshots in performance_metrics.
 *
 * Invoked by the daily cron (GET /api/cron/analytics-pull) and the
 * dashboard's manual trigger (POST /api/analytics/pull).
 *
 * Blotato has two id spaces: POST /posts returns a submission UUID (what we
 * store in published_platforms.post_id), while the analytics endpoint keys on
 * the numeric published-post id from the posts LIST endpoint. The join is the
 * live post URL: getPostStatus(submissionId) → publicUrl, list item → postUrl.
 * Resolved URLs are written back to published_platforms.post_url so each
 * submission is only resolved once.
 */

const LOOKBACK_DAYS = 60;
/** Bound Blotato calls per run so the route stays well inside function limits. */
const MAX_URL_RESOLUTIONS_PER_RUN = 80;
const MAX_ANALYTICS_FETCHES_PER_RUN = 300;

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Collapse Blotato's wide metric set onto our performance_metrics columns.
 *  Platforms disagree on naming: views may arrive as viewsCount (YT/TT),
 *  playsCount (IG reels) or impressionsCount (Twitter/Threads). */
export function mapMetrics(m: Record<string, number | null | undefined>) {
    const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const shares =
        n(m.sharesCount) +
        n(m.twitterRetweetsCount) + n(m.twitterQuotesCount) +
        n(m.threadsRepostsCount) + n(m.threadsQuotesCount) +
        n(m.blueskyRepostsCount) + n(m.blueskyQuotesCount);
    return {
        views: n(m.viewsCount) || n(m.playsCount) || n(m.impressionsCount),
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
    snapshots: number;
    noMetricsYet: number;
    unmatched: number;
    insertErrors: number;
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
        snapshots: 0,
        noMetricsYet: 0,
        unmatched: 0,
        insertErrors: 0,
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

    // -- Step 2: build postUrl → numeric published-post id map from Blotato
    const urlToListId = new Map<string, string>();
    let cursor: string | undefined;
    do {
        const page = await blotato.listPublishedPosts(sinceIso, cursor);
        for (const item of page.items) {
            if (item.state.type === 'published' && item.state.postUrl) {
                urlToListId.set(item.state.postUrl, item.id);
            }
        }
        cursor = page.cursor;
    } while (cursor);

    // -- Step 3: fetch analytics per resolved platform entry, snapshot to DB
    let fetchesLeft = MAX_ANALYTICS_FETCHES_PER_RUN;
    const seenListIds = new Set<string>();
    for (const piece of pieces as PieceRow[]) {
        const platforms = piece.published_platforms;
        if (!platforms) continue;

        for (const [platform, entry] of Object.entries(platforms) as Array<[string, PlatformStatus | undefined]>) {
            if (!entry || entry.status !== 'published' || !entry.post_url) continue;
            const listId = urlToListId.get(entry.post_url);
            if (!listId) { result.unmatched++; continue; }
            if (seenListIds.has(listId)) continue;
            seenListIds.add(listId);
            if (fetchesLeft <= 0) break;
            fetchesLeft--;

            try {
                const analytics = await blotato.getPostAnalytics(listId);
                if (!analytics.metrics || !analytics.lastFetchedAt) {
                    result.noMetricsYet++;
                    continue;
                }
                const mapped = mapMetrics(analytics.metrics);
                const hasSignal = mapped.views + mapped.likes + mapped.comments + mapped.shares + mapped.saves > 0;
                if (!hasSignal) { result.noMetricsYet++; continue; }

                const { error: insertError } = await supabase.from('performance_metrics').insert({
                    content_piece_id: piece.id,
                    platform,
                    ...mapped,
                });
                if (insertError) result.insertErrors++;
                else result.snapshots++;
            } catch {
                result.insertErrors++;
            }
            await sleep(150);
        }
    }

    return { status: 200, body: result };
}
