'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface TopPost {
    content_piece_id: string;
    topic_title: string;
    platform: string;
    saves: number;
    shares: number;
    views: number;
    likes: number;
}

export function AnalyticsSummary() {
    const supabase = useMemo(() => createClient(), []);
    const [topPosts, setTopPosts] = useState<TopPost[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            // Get the latest metrics snapshot per content_piece + platform,
            // then rank by engagement (saves + shares as primary signal)
            const { data: metrics } = await supabase
                .from('performance_metrics')
                .select('content_piece_id, platform, views, likes, shares, saves')
                .order('captured_at', { ascending: false });

            if (!metrics || metrics.length === 0) {
                setLoading(false);
                return;
            }

            // Deduplicate: keep only the latest snapshot per piece+platform
            const latest = new Map<string, typeof metrics[0]>();
            for (const m of metrics) {
                const key = `${m.content_piece_id}:${m.platform}`;
                if (!latest.has(key)) {
                    latest.set(key, m);
                }
            }

            // Sort by saves + shares (engagement signal)
            const sorted = Array.from(latest.values())
                .sort((a, b) => (b.saves + b.shares) - (a.saves + a.shares))
                .slice(0, 5);

            // Fetch topic titles for display
            const pieceIds = sorted.map(s => s.content_piece_id);
            const { data: pieces } = await supabase
                .from('content_pieces')
                .select('id, topic_id')
                .in('id', pieceIds);

            const topicIds = (pieces ?? []).map(p => p.topic_id).filter(Boolean);
            const { data: topics } = await supabase
                .from('topics')
                .select('id, title')
                .in('id', topicIds);

            const topicMap = new Map((topics ?? []).map(t => [t.id, t.title]));
            const pieceTopicMap = new Map((pieces ?? []).map(p => [p.id, p.topic_id]));

            const topPostsData: TopPost[] = sorted.map(m => ({
                content_piece_id: m.content_piece_id,
                topic_title: topicMap.get(pieceTopicMap.get(m.content_piece_id) ?? '') ?? 'Unknown',
                platform: m.platform,
                saves: m.saves,
                shares: m.shares,
                views: m.views,
                likes: m.likes,
            }));

            setTopPosts(topPostsData);
            setLoading(false);
        }
        load();
    }, [supabase]);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Top Performing Posts</CardTitle>
                    <CardDescription>Loading...</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    if (topPosts.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Top Performing Posts</CardTitle>
                    <CardDescription>No analytics data yet. Pull analytics to see top posts.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Top Performing Posts</CardTitle>
                <CardDescription>Ranked by saves + shares</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {topPosts.map((post, i) => (
                        <div key={`${post.content_piece_id}-${post.platform}`} className="flex items-start gap-3">
                            <span className="text-lg font-bold text-muted-foreground w-6 shrink-0">
                                {i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{post.topic_title}</p>
                                <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                                    <span className="capitalize">{post.platform}</span>
                                    <span>{post.views.toLocaleString()} views</span>
                                    <span>{post.likes.toLocaleString()} likes</span>
                                    <span>{post.shares.toLocaleString()} shares</span>
                                    <span>{post.saves.toLocaleString()} saves</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
