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

    const recommendations = buildRecommendations(accounts, PLATFORMS.map((p) => health[p]));

    return NextResponse.json({
        generatedAt: new Date(now).toISOString(),
        metricsWindowDays: METRICS_WINDOW_DAYS,
        publishWindowDays: PUBLISH_WINDOW_DAYS,
        accounts,
        health: PLATFORMS.map((p) => health[p]),
        recommendations,
        hasMetrics: accounts.length > 0,
        error: perfError?.message,
        blotatoError,
    });
}

export interface Recommendation { kind: 'scale' | 'resonates' | 'fix' | 'blindspot' | 'rethink'; severity: 'good' | 'warn' | 'bad'; text: string; }

/** The "adjust toward what works" layer: cross-account, data-derived guidance —
 *  what to scale, what's resonating, what to fix. Deterministic (no LLM), so it
 *  is stable and explainable. Human-in-the-loop: it recommends, it doesn't yet
 *  re-allocate the generators automatically. */
function buildRecommendations(accounts: AccountRow[], health: PlatformHealth[]): Recommendation[] {
    const recs: Recommendation[] = [];
    const vpp = (a: AccountRow) => (a.posts > 0 ? a.views / a.posts : 0);
    const label = (a: AccountRow) => `${a.brand || a.handle} (${a.handle} · ${a.platform})`;

    const scored = accounts.filter((a) => a.posts >= 2);
    if (scored.length) {
        // Reach leader — where each post goes furthest.
        const reach = [...scored].sort((a, b) => vpp(b) - vpp(a))[0];
        recs.push({ kind: 'scale', severity: 'good',
            text: `${label(reach)} is your reach leader at ${Math.round(vpp(reach)).toLocaleString()} views/post — increase its cadence.` });

        // Engagement leader — what resonates (needs a little reach to be real).
        const eng = [...scored].filter((a) => a.views >= 200).sort((a, b) => b.engagementRate - a.engagementRate)[0];
        if (eng && eng.engagementRate > 0) {
            recs.push({ kind: 'resonates', severity: 'good',
                text: `${label(eng)} has the strongest engagement (${(eng.engagementRate * 100).toFixed(1)}%) — its format resonates; make more like it.` });
        }

        // Underperformer — lowest reach among accounts with real volume.
        const laggard = [...scored].filter((a) => a.posts >= 5).sort((a, b) => vpp(a) - vpp(b))[0];
        if (laggard && laggard !== reach) {
            recs.push({ kind: 'rethink', severity: 'warn',
                text: `${label(laggard)} has the lowest reach (${Math.round(vpp(laggard)).toLocaleString()} views/post) over ${laggard.posts} posts — rethink the hook or trim cadence.` });
        }
    }

    // Publishing failures worth acting on.
    for (const h of health) {
        const total = h.publishedRecent + h.failedRecent;
        if (h.failedRecent >= 3 && h.failedRecent >= total * 0.4) {
            recs.push({ kind: 'fix', severity: 'bad',
                text: `${h.platform} publishing is failing (${h.failedRecent}/${total} in 14d) — fix before adding volume there.` });
        }
    }

    // Blind spots: publishing but no engagement data (can't optimize what you can't see).
    const platformsWithMetrics = new Set(accounts.map((a) => a.platform));
    for (const h of health) {
        if (h.connected && h.publishedRecent >= 5 && !platformsWithMetrics.has(h.platform)) {
            recs.push({ kind: 'blindspot', severity: 'warn',
                text: `${h.platform} is publishing (${h.publishedRecent}/14d) but has no engagement data — reconnect in Blotato for insights, it's a blind spot.` });
        }
    }

    return recs;
}
