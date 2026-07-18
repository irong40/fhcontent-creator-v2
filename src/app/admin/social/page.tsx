'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface PlatformSummary {
    platform: string;
    connected: boolean;
    accounts: string[];
    lastPublishedAt: string | null;
    publishedRecent: number;
    failedRecent: number;
    posts: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagementRate: number;
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

interface SocialStatus {
    generatedAt: string;
    publishWindowDays: number;
    metricsWindowDays: number;
    totals: { accountsConnected: number; views: number; posts: number; failedRecent: number };
    platforms: PlatformSummary[];
    topPosts: TopPost[];
    hasMetrics: boolean;
    blotatoError?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
    tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram',
    twitter: 'Twitter / X', threads: 'Threads', facebook: 'Facebook',
};

function fmt(n: number): string {
    return n.toLocaleString();
}

function relative(iso: string | null): string {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3.6e6);
    if (h < 1) return 'under an hour ago';
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

export default function SocialDashboardPage() {
    const [data, setData] = useState<SocialStatus | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/social-status');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setData((await res.json()) as SocialStatus);
        } catch (e) {
            toast.error(`Failed to load social status: ${(e as Error).message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const maxViews = Math.max(1, ...(data?.platforms.map((p) => p.views) ?? [1]));

    return (
        <div className="container max-w-screen-2xl py-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Social Media Status</h1>
                    {data && (
                        <p className="text-sm text-muted-foreground mt-1">
                            Updated {relative(data.generatedAt)} · performance over {data.metricsWindowDays}d,
                            publishing over {data.publishWindowDays}d
                        </p>
                    )}
                </div>
                <Button size="sm" variant="outline" onClick={load} disabled={loading}>
                    {loading ? 'Refreshing…' : 'Refresh'}
                </Button>
            </div>

            {loading && !data && <div className="text-muted-foreground">Loading…</div>}

            {data && (
                <>
                    {data.blotatoError && (
                        <Card className="border-yellow-500/40">
                            <CardContent className="py-3 text-sm text-yellow-500">
                                Account connections couldn&apos;t be loaded from Blotato ({data.blotatoError}).
                                Publishing and performance below are still accurate.
                            </CardContent>
                        </Card>
                    )}

                    {/* Totals */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Stat label="Accounts connected" value={fmt(data.totals.accountsConnected)} />
                        <Stat label={`Views (${data.metricsWindowDays}d)`} value={fmt(data.totals.views)} />
                        <Stat label="Posts tracked" value={fmt(data.totals.posts)} />
                        <Stat
                            label={`Publish failures (${data.publishWindowDays}d)`}
                            value={fmt(data.totals.failedRecent)}
                            tone={data.totals.failedRecent > 0 ? 'bad' : 'good'}
                        />
                    </div>

                    {/* Account health */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">Account health</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {data.platforms.map((p) => (
                                <Card key={p.platform}>
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <CardTitle className="text-base">
                                                {PLATFORM_LABEL[p.platform] ?? p.platform}
                                            </CardTitle>
                                            {p.connected ? (
                                                <Badge variant="secondary">Connected</Badge>
                                            ) : (
                                                <Badge variant="outline">Not connected</Badge>
                                            )}
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm">
                                        <div className="text-muted-foreground truncate">
                                            {p.accounts.length ? p.accounts.join(', ') : '—'}
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Last posted</span>
                                            <span>{relative(p.lastPublishedAt)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Published (14d)</span>
                                            <span>{fmt(p.publishedRecent)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Failed (14d)</span>
                                            <span className={p.failedRecent > 0 ? 'text-red-400 font-medium' : ''}>
                                                {fmt(p.failedRecent)}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </section>

                    {/* Performance */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">Performance</h2>
                        {!data.hasMetrics ? (
                            <Card>
                                <CardContent className="py-8 text-center text-muted-foreground">
                                    No performance snapshots yet. The daily analytics pull will populate this as
                                    Blotato collects engagement.
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardContent className="py-4 space-y-3">
                                    {data.platforms
                                        .filter((p) => p.posts > 0)
                                        .sort((a, b) => b.views - a.views)
                                        .map((p) => (
                                            <div key={p.platform} className="space-y-1">
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="font-medium">
                                                        {PLATFORM_LABEL[p.platform] ?? p.platform}
                                                    </span>
                                                    <span className="text-muted-foreground">
                                                        {fmt(p.views)} views · {(p.engagementRate * 100).toFixed(1)}% eng ·
                                                        {' '}{fmt(p.posts)} posts
                                                    </span>
                                                </div>
                                                <div className="h-2 rounded bg-muted overflow-hidden">
                                                    <div
                                                        className="h-full bg-primary"
                                                        style={{ width: `${Math.max(2, (p.views / maxViews) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                </CardContent>
                            </Card>
                        )}
                    </section>

                    {/* Top posts */}
                    {data.topPosts.length > 0 && (
                        <section className="space-y-3">
                            <h2 className="text-lg font-semibold">Top posts ({data.metricsWindowDays}d)</h2>
                            <Card>
                                <CardContent className="py-4 space-y-3">
                                    {data.topPosts.map((post, i) => (
                                        <div
                                            key={`${post.content_piece_id}-${post.platform}`}
                                            className="flex items-start gap-3"
                                        >
                                            <span className="text-lg font-bold text-muted-foreground w-6 shrink-0">
                                                {i + 1}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{post.title}</p>
                                                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                                                    <span className="capitalize">{post.platform}</span>
                                                    <span>{fmt(post.views)} views</span>
                                                    <span>{fmt(post.likes)} likes</span>
                                                    <span>{fmt(post.shares)} shares</span>
                                                    <span>{fmt(post.saves)} saves</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </section>
                    )}
                </>
            )}
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
    return (
        <Card>
            <CardContent className="py-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div
                    className={`text-2xl font-semibold mt-1 ${
                        tone === 'bad' ? 'text-red-400' : ''
                    }`}
                >
                    {value}
                </div>
            </CardContent>
        </Card>
    );
}
