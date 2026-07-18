import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import type { PublishedPlatforms, PlatformStatus } from '@/types/database';

/**
 * GET /api/social-status — data for the /admin/social dashboard.
 *
 * Two halves:
 *  1. Account health — connected accounts pulled live from Blotato, plus recent
 *     publish activity (published / failed in the last 14 days, last-posted)
 *     derived from content_pieces.published_platforms.
 *  2. Performance — per-platform reach/engagement from the latest
 *     performance_metrics snapshot per piece, plus the top posts.
 *
 * Sits behind the app's auth middleware (browser session). Uses the service
 * role client for DB reads and the server-only Blotato key.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'twitter', 'threads', 'facebook'] as const;
type PlatformKey = (typeof PLATFORMS)[number];

const PUBLISH_WINDOW_DAYS = 14;
const METRICS_WINDOW_DAYS = 30;

interface PlatformSummary {
    platform: PlatformKey;
    connected: boolean;
    accounts: string[];          // connected @usernames on this platform
    lastPublishedAt: string | null;
    publishedRecent: number;     // last 14d
    failedRecent: number;        // last 14d
    posts: number;               // pieces with a metrics snapshot (30d)
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagementRate: number;      // (likes+comments+shares+saves) / views
}

interface TopPost {
    content_piece_id: string;
    title: string;
    platform: string;
    views: number;
    likes: number;
    shares: number;
    saves: number;
}

function emptySummary(platform: PlatformKey): PlatformSummary {
    return {
        platform,
        connected: false,
        accounts: [],
        lastPublishedAt: null,
        publishedRecent: 0,
        failedRecent: 0,
        posts: 0,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        engagementRate: 0,
    };
}

export async function GET() {
    const supabase = createAdminClient();
    const now = Date.now();
    const publishSince = new Date(now - PUBLISH_WINDOW_DAYS * 864e5).toISOString();
    const metricsSince = new Date(now - METRICS_WINDOW_DAYS * 864e5).toISOString();

    const summaries: Record<PlatformKey, PlatformSummary> =
        Object.fromEntries(PLATFORMS.map((p) => [p, emptySummary(p)])) as Record<PlatformKey, PlatformSummary>;

    // -- 1a. Connected accounts (Blotato). Non-fatal: dashboard still shows
    // publish + performance if Blotato is unreachable.
    let blotatoError: string | undefined;
    try {
        const accounts = await blotato.getAccounts();
        for (const a of accounts) {
            const key = a.platform as PlatformKey;
            if (summaries[key]) {
                summaries[key].connected = true;
                summaries[key].accounts.push(a.username ? `@${a.username}` : a.fullname);
            }
        }
    } catch (e) {
        blotatoError = (e as Error).message;
    }

    // -- 1b. Recent publish activity from content_pieces.published_platforms.
    const { data: recent } = await supabase
        .from('content_pieces')
        .select('published_platforms, published_at')
        .gte('published_at', publishSince);

    for (const row of recent ?? []) {
        const platforms = row.published_platforms as PublishedPlatforms | null;
        if (!platforms) continue;
        for (const [platform, entry] of Object.entries(platforms) as Array<[string, PlatformStatus | undefined]>) {
            const s = summaries[platform as PlatformKey];
            if (!s || !entry) continue;
            if (entry.status === 'published') {
                s.publishedRecent++;
                const at = entry.published_at ?? row.published_at ?? null;
                if (at && (!s.lastPublishedAt || at > s.lastPublishedAt)) s.lastPublishedAt = at;
            } else if (entry.status === 'failed') {
                s.failedRecent++;
            }
        }
    }

    // -- 2. Performance: latest snapshot per (piece, platform) in the window.
    const { data: metrics } = await supabase
        .from('performance_metrics')
        .select('content_piece_id, platform, views, likes, comments, shares, saves, captured_at')
        .gte('captured_at', metricsSince)
        .order('captured_at', { ascending: false });

    const latest = new Map<string, NonNullable<typeof metrics>[number]>();
    for (const m of metrics ?? []) {
        const key = `${m.content_piece_id}:${m.platform}`;
        if (!latest.has(key)) latest.set(key, m);
    }

    for (const m of latest.values()) {
        const s = summaries[m.platform as PlatformKey];
        if (!s) continue;
        s.posts++;
        s.views += m.views ?? 0;
        s.likes += m.likes ?? 0;
        s.comments += m.comments ?? 0;
        s.shares += m.shares ?? 0;
        s.saves += m.saves ?? 0;
    }
    for (const s of Object.values(summaries)) {
        const engaged = s.likes + s.comments + s.shares + s.saves;
        s.engagementRate = s.views > 0 ? engaged / s.views : 0;
    }

    // -- Top posts (by views) with titles.
    const ranked = Array.from(latest.values())
        .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
        .slice(0, 8);
    const pieceIds = [...new Set(ranked.map((r) => r.content_piece_id))];

    let titleByPiece = new Map<string, string>();
    if (pieceIds.length > 0) {
        const { data: pieces } = await supabase
            .from('content_pieces')
            .select('id, topic_id')
            .in('id', pieceIds);
        const topicIds = [...new Set((pieces ?? []).map((p) => p.topic_id).filter(Boolean))] as string[];
        const topicTitle = new Map<string, string>();
        if (topicIds.length > 0) {
            const { data: topics } = await supabase.from('topics').select('id, title').in('id', topicIds);
            for (const t of topics ?? []) topicTitle.set(t.id, t.title);
        }
        titleByPiece = new Map(
            (pieces ?? []).map((p) => [p.id, topicTitle.get(p.topic_id ?? '') ?? 'Untitled']),
        );
    }

    const topPosts: TopPost[] = ranked.map((r) => ({
        content_piece_id: r.content_piece_id,
        title: titleByPiece.get(r.content_piece_id) ?? 'Untitled',
        platform: r.platform,
        views: r.views ?? 0,
        likes: r.likes ?? 0,
        shares: r.shares ?? 0,
        saves: r.saves ?? 0,
    }));

    const platforms = PLATFORMS.map((p) => summaries[p]);
    const totals = {
        accountsConnected: platforms.filter((p) => p.connected).length,
        views: platforms.reduce((n, p) => n + p.views, 0),
        posts: platforms.reduce((n, p) => n + p.posts, 0),
        failedRecent: platforms.reduce((n, p) => n + p.failedRecent, 0),
    };

    return NextResponse.json({
        generatedAt: new Date(now).toISOString(),
        publishWindowDays: PUBLISH_WINDOW_DAYS,
        metricsWindowDays: METRICS_WINDOW_DAYS,
        totals,
        platforms,
        topPosts,
        hasMetrics: latest.size > 0,
        blotatoError,
    });
}
