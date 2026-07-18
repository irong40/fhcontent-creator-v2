import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { mapMetrics } from '@/lib/analytics-pull';
import type { PublishedPlatforms, PlatformStatus } from '@/types/database';
import type { BlotatoAnalyticsListItem, BlotatoAnalyticsSortBy } from '@/lib/blotato';

/**
 * GET /api/social-status — data for the /admin/social dashboard, keyed by
 * ACCOUNT (not platform), so brands with different purposes are tracked apart
 * (e.g. Sentinel's Part 107 TikTok vs the Faith & Harmony history TikTok).
 *
 * Attribution: the reliable key is the @handle in the post URL — that's the
 * actual account the post landed on. persona→account mapping is unreliable here
 * (personas share Blotato accounts), so we map handle→brand via ACCOUNTS below.
 *
 * Source: Blotato GET /v2/analytics (all accounts, including the separate
 * Sentinel pipeline that never touches content_pieces). YouTube URLs carry no
 * channel, so YouTube is reported as one combined line for now.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANALYTICS_SORT_KEYS: BlotatoAnalyticsSortBy[] = ['views_count', 'likes_count', 'comments_count', 'reach_count'];
const ANALYTICS_PAGE_LIMIT = 100;
const PUBLISH_WINDOW_DAYS = 14;
const METRICS_WINDOW_DAYS = 30;

/** Handle → brand/purpose. The @handle in a post URL is the ground truth of
 *  which account a post landed on. Extend this when a new account is added. */
const ACCOUNTS: Record<string, { brand: string; purpose: string }> = {
    sentinelaerialinspector: { brand: 'Sentinel Aerial', purpose: 'Part 107 training' },
    northeastcorner1: { brand: 'North East Corner', purpose: 'Masonic education' },
    faithharmony04: { brand: 'Faith & Harmony', purpose: 'Black history + music' },
    faithharmony4045: { brand: 'Faith & Harmony', purpose: 'Black history + music' },
    apiercea45: { brand: 'Faith & Harmony', purpose: 'Cyber / history' },
};

/** Pull the @handle out of a post URL for the platforms whose URLs carry one. */
function handleFromUrl(url: string | null): string | null {
    if (!url) return null;
    const at = url.match(/(?:tiktok\.com|threads\.net)\/@([^/?#]+)/i);
    if (at) return at[1].toLowerCase();
    const tw = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status/i);
    if (tw) return tw[1].toLowerCase();
    return null;
}

interface AccountPerf {
    key: string;
    label: string;         // e.g. "Sentinel Aerial · @sentinelaerialinspector"
    brand: string;
    purpose: string;
    platform: string;
    handle: string | null;
    posts: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagementRate: number;
    lastPostedAt: string | null;
    topTitle: string | null;
    topViews: number;
}

interface PlatformHealth {
    platform: string;
    connected: boolean;
    accounts: string[];
    lastPublishedAt: string | null;
    publishedRecent: number;
    failedRecent: number;
}

export async function GET() {
    const supabase = createAdminClient();
    const now = Date.now();
    const metricsSince = new Date(now - METRICS_WINDOW_DAYS * 864e5).toISOString();
    const publishSince = new Date(now - PUBLISH_WINDOW_DAYS * 864e5).toISOString();

    // -- Connected accounts + a fallback handle→brand map from live usernames.
    const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'twitter', 'threads', 'facebook'];
    const health: Record<string, PlatformHealth> = Object.fromEntries(
        PLATFORMS.map((p) => [p, { platform: p, connected: false, accounts: [], lastPublishedAt: null, publishedRecent: 0, failedRecent: 0 }]),
    );
    let blotatoError: string | undefined;
    try {
        const accounts = await blotato.getAccounts();
        for (const a of accounts) {
            const h = health[a.platform];
            if (h) {
                h.connected = true;
                h.accounts.push(a.username ? `@${a.username}` : a.fullname);
            }
        }
    } catch (e) {
        blotatoError = (e as Error).message;
    }

    // -- Recent publish activity (per platform) from content_pieces.
    const { data: recent } = await supabase
        .from('content_pieces')
        .select('published_platforms, published_at')
        .gte('published_at', publishSince);
    for (const row of recent ?? []) {
        const platforms = row.published_platforms as PublishedPlatforms | null;
        if (!platforms) continue;
        for (const [platform, entry] of Object.entries(platforms) as Array<[string, PlatformStatus | undefined]>) {
            const h = health[platform];
            if (!h || !entry) continue;
            if (entry.status === 'published') {
                h.publishedRecent++;
                const at = entry.published_at ?? row.published_at ?? null;
                if (at && (!h.lastPublishedAt || at > h.lastPublishedAt)) h.lastPublishedAt = at;
            } else if (entry.status === 'failed') {
                h.failedRecent++;
            }
        }
    }

    // -- Per-account performance from Blotato /v2/analytics (all accounts).
    const items = new Map<string, BlotatoAnalyticsListItem>();
    for (const sortBy of ANALYTICS_SORT_KEYS) {
        try {
            const res = await blotato.listTopPosts({ sortBy, since: metricsSince, limit: ANALYTICS_PAGE_LIMIT });
            for (const it of res.items ?? []) if (!items.has(it.id)) items.set(it.id, it);
        } catch (e) {
            console.error(`[social-status] listTopPosts(${sortBy}) failed:`, (e as Error).message);
        }
    }

    const perf = new Map<string, AccountPerf>();
    for (const it of items.values()) {
        const metrics = it.latestMetrics?.metrics;
        if (!metrics) continue;
        const m = mapMetrics(metrics);
        const handle = handleFromUrl(it.postUrl);
        // YouTube (and any handle-less platform) is bucketed as one combined line.
        const key = handle ? `${it.platform}:${handle}` : `${it.platform}:*`;
        const meta = handle ? ACCOUNTS[handle] : undefined;
        const brand = meta?.brand ?? (handle ? `@${handle}` : 'All channels');
        const purpose = meta?.purpose ?? '';
        const label = handle
            ? `${brand} · @${handle}`
            : `${it.platform === 'youtube' ? 'YouTube' : it.platform} · all channels`;

        let acc = perf.get(key);
        if (!acc) {
            acc = {
                key, label, brand, purpose, platform: it.platform, handle,
                posts: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
                engagementRate: 0, lastPostedAt: null, topTitle: null, topViews: 0,
            };
            perf.set(key, acc);
        }
        acc.posts++;
        acc.views += m.views; acc.likes += m.likes; acc.comments += m.comments;
        acc.shares += m.shares; acc.saves += m.saves;
        if (it.createdAt && (!acc.lastPostedAt || it.createdAt > acc.lastPostedAt)) acc.lastPostedAt = it.createdAt;
        if (m.views > acc.topViews) {
            acc.topViews = m.views;
            acc.topTitle = (it.content || '').split('\n')[0].slice(0, 90) || null;
        }
    }
    const accounts = [...perf.values()]
        .map((a) => ({ ...a, engagementRate: a.views > 0 ? (a.likes + a.comments + a.shares + a.saves) / a.views : 0 }))
        .sort((a, b) => b.views - a.views);

    return NextResponse.json({
        generatedAt: new Date(now).toISOString(),
        metricsWindowDays: METRICS_WINDOW_DAYS,
        publishWindowDays: PUBLISH_WINDOW_DAYS,
        health: PLATFORMS.map((p) => health[p]),
        accounts,
        hasMetrics: accounts.length > 0,
        youtubeCombined: accounts.some((a) => a.platform === 'youtube' && a.handle === null),
        blotatoError,
    });
}
