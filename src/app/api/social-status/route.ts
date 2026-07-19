import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import type { PublishedPlatforms, PlatformStatus } from '@/types/database';

/**
 * GET /api/social-status — data for the /admin/social dashboard, keyed by
 * ACCOUNT so brands with different purposes are tracked apart (e.g. Sentinel's
 * Part 107 TikTok vs the Faith & Harmony history TikTok).
 *
 * Performance comes from stored history via get_account_performance (accurate,
 * accumulating), attributed to accounts through the blotato_accounts registry.
 * The collector also snapshots the separate-pipeline accounts (Sentinel), so
 * they appear here too. Connection health comes live from Blotato.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const METRICS_WINDOW_DAYS = 30;
const PUBLISH_WINDOW_DAYS = 14;
const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'twitter', 'threads', 'facebook'];

interface AccountRow {
    handle: string; brand: string; purpose: string; platform: string;
    posts: number; views: number; likes: number; comments: number; shares: number; saves: number;
    engagementRate: number; lastPostedAt: string | null;
}

interface PlatformHealth {
    platform: string; connected: boolean; accounts: string[];
    lastPublishedAt: string | null; publishedRecent: number; failedRecent: number;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export async function GET() {
    const supabase = createAdminClient();
    const now = Date.now();
    const publishSince = new Date(now - PUBLISH_WINDOW_DAYS * 864e5).toISOString();

    // -- Per-account performance from stored history.
    const { data: perfData, error: perfError } = await supabase
        .rpc('get_account_performance', { p_days: METRICS_WINDOW_DAYS });
    const accounts: AccountRow[] = (perfData ?? []).map((r: Record<string, unknown>) => {
        const views = num(r.views), likes = num(r.likes), comments = num(r.comments),
            shares = num(r.shares), saves = num(r.saves);
        return {
            handle: String(r.handle ?? ''), brand: String(r.brand ?? ''), purpose: String(r.purpose ?? ''),
            platform: String(r.platform ?? ''),
            posts: num(r.posts), views, likes, comments, shares, saves,
            engagementRate: views > 0 ? (likes + comments + shares + saves) / views : 0,
            lastPostedAt: (r.last_post as string) ?? null,
        };
    });

    // -- Connection health + recent publish activity per platform.
    const health: Record<string, PlatformHealth> = Object.fromEntries(
        PLATFORMS.map((p) => [p, { platform: p, connected: false, accounts: [], lastPublishedAt: null, publishedRecent: 0, failedRecent: 0 }]),
    );
    let blotatoError: string | undefined;
    try {
        for (const a of await blotato.getAccounts()) {
            const h = health[a.platform];
            if (h) { h.connected = true; h.accounts.push(a.username ? `@${a.username}` : a.fullname); }
        }
    } catch (e) {
        blotatoError = (e as Error).message;
    }

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

    return NextResponse.json({
        generatedAt: new Date(now).toISOString(),
        metricsWindowDays: METRICS_WINDOW_DAYS,
        publishWindowDays: PUBLISH_WINDOW_DAYS,
        accounts,
        health: PLATFORMS.map((p) => health[p]),
        hasMetrics: accounts.length > 0,
        error: perfError?.message,
        blotatoError,
    });
}
