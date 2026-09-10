'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface AccountPerf {
    handle: string;
    brand: string;
    purpose: string;
    platform: string;
    posts: number;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagementRate: number;
    lastPostedAt: string | null;
}

interface PlatformHealth {
    platform: string;
    connected: boolean;
    accounts: string[];
    lastPublishedAt: string | null;
    publishedRecent: number;
    failedRecent: number;
}

interface SocialStatus {
    generatedAt: string;
    metricsWindowDays: number;
    publishWindowDays: number;
    health: PlatformHealth[];
    accounts: AccountPerf[];
    recommendations: Recommendation[];
    hasMetrics: boolean;
    blotatoError?: string;
}

interface Recommendation {
    kind: 'scale' | 'resonates' | 'fix' | 'blindspot' | 'rethink';
    severity: 'good' | 'warn' | 'bad';
    text: string;
}

const PLATFORM_LABEL: Record<string, string> = {
    tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram',
    twitter: 'Twitter / X', threads: 'Threads', facebook: 'Facebook',
};

const fmt = (n: number) => n.toLocaleString();

function recIcon(kind: Recommendation['kind']): string {
    return { scale: '📈', resonates: '✨', fix: '🔧', blindspot: '🔍', rethink: '⚠️' }[kind] ?? '•';
}
function recBorder(sev: Recommendation['severity']): string {
    if (sev === 'bad') return 'border-red-500/40';
    if (sev === 'warn') return 'border-yellow-500/40';
    return 'border-green-500/40';
}

function relative(iso: string | null): string {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3.6e6);
    if (h < 1) return 'under an hour ago';
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
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

    const maxViews = Math.max(1, ...(data?.accounts.map((a) => a.views) ?? [1]));

    return (
        <div className="container max-w-screen-2xl py-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Social Media Status</h1>
                    {data && (
                        <p className="text-sm text-muted-foreground mt-1">
                            By account · updated {relative(data.generatedAt)} · performance over {data.metricsWindowDays}d
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
                                Account data couldn&apos;t be loaded from Blotato ({data.blotatoError}).
                            </CardContent>
                        </Card>
                    )}

                    {/* What's working / what to do — the feedback layer */}
                    {data.recommendations && data.recommendations.length > 0 && (
                        <section className="space-y-3">
                            <h2 className="text-lg font-semibold">What&apos;s working &amp; what to do</h2>
                            <div className="space-y-2">
                                {data.recommendations.map((r, i) => (
                                    <Card key={i} className={recBorder(r.severity)}>
                                        <CardContent className="py-3 flex items-start gap-3 text-sm">
                                            <span className="shrink-0">{recIcon(r.kind)}</span>
                                            <span>{r.text}</span>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Per-account performance — the main view */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">Accounts</h2>
                        {!data.hasMetrics ? (
                            <Card>
                                <CardContent className="py-8 text-center text-muted-foreground">
                                    No per-account metrics stored yet. The daily analytics pull populates this.
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {data.accounts.map((a) => (
                                    <Card key={`${a.platform}:${a.handle}`}>
                                        <CardHeader className="pb-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <CardTitle className="text-base truncate">{a.brand || a.handle}</CardTitle>
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        {a.handle}{a.purpose ? ` · ${a.purpose}` : ''}
                                                    </p>
                                                </div>
                                                <Badge variant="outline" className="capitalize shrink-0">
                                                    {PLATFORM_LABEL[a.platform] ?? a.platform}
                                                </Badge>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="space-y-2 text-sm">
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-semibold">{fmt(a.views)}</span>
                                                <span className="text-xs text-muted-foreground">views · {a.posts} posts</span>
                                            </div>
                                            <div className="h-2 rounded bg-muted overflow-hidden">
                                                <div className="h-full bg-primary" style={{ width: `${Math.max(2, (a.views / maxViews) * 100)}%` }} />
                                            </div>
                                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                                <span>{(a.engagementRate * 100).toFixed(1)}% eng</span>
                                                <span>{fmt(a.likes)} likes</span>
                                                <span>{fmt(a.comments)} comments</span>
                                                <span>last post {relative(a.lastPostedAt)}</span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Connection + publish health per platform */}
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">Connections &amp; publishing</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {data.health.map((h) => (
                                <Card key={h.platform}>
                                    <CardHeader className="pb-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <CardTitle className="text-base">{PLATFORM_LABEL[h.platform] ?? h.platform}</CardTitle>
                                            {h.connected
                                                ? <Badge variant="secondary">Connected</Badge>
                                                : <Badge variant="outline">Not connected</Badge>}
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-2 text-sm">
                                        <div className="text-muted-foreground truncate">
                                            {h.accounts.length ? h.accounts.join(', ') : '—'}
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Published (14d)</span>
                                            <span>{fmt(h.publishedRecent)}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-muted-foreground">Failed (14d)</span>
                                            <span className={h.failedRecent > 0 ? 'text-red-400 font-medium' : ''}>
                                                {fmt(h.failedRecent)}
                                            </span>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
