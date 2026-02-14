'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Persona, Topic } from '@/types/database';

export default function PlanPage() {
    const supabase = createClient();
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [generating, setGenerating] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            const [personasRes, topicsRes] = await Promise.all([
                supabase.from('personas').select('*').eq('is_active', true),
                supabase.from('topics').select('*').order('created_at', { ascending: false }).limit(20),
            ]);
            if (personasRes.data) setPersonas(personasRes.data);
            if (topicsRes.data) setTopics(topicsRes.data);
        }
        load();
    }, [supabase]);

    async function generateTopic(personaId: string) {
        setGenerating(personaId);
        setError(null);
        try {
            const res = await fetch('/api/topics/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personaId, count: 1 }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || 'Topic generation failed');
                return;
            }
            // Refresh topics
            const { data: refreshed } = await supabase
                .from('topics')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20);
            if (refreshed) setTopics(refreshed);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setGenerating(null);
        }
    }

    async function generateContent(topicId: string) {
        setGenerating(topicId);
        setError(null);
        try {
            const res = await fetch('/api/content/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topicId }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || 'Content generation failed');
                return;
            }
            // Refresh topics
            const { data: refreshed } = await supabase
                .from('topics')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20);
            if (refreshed) setTopics(refreshed);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setGenerating(null);
        }
    }

    const statusColor: Record<string, string> = {
        draft: 'bg-yellow-600',
        content_generating: 'bg-blue-600',
        content_ready: 'bg-green-600',
        approved: 'bg-emerald-600',
        scheduled: 'bg-purple-600',
        published: 'bg-gray-600',
        failed: 'bg-red-600',
    };

    return (
        <div className="container max-w-screen-lg py-8">
            <h1 className="text-3xl font-bold mb-8">Content Plan</h1>

            {error && (
                <div className="bg-destructive/20 border border-destructive text-destructive-foreground rounded-md p-3 mb-6">
                    {error}
                </div>
            )}

            {/* Persona actions */}
            <Card className="mb-8">
                <CardHeader>
                    <CardTitle>Generate Topics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {personas.map(p => (
                        <div key={p.id} className="flex items-center justify-between">
                            <div>
                                <span className="font-medium">{p.name}</span>
                                <span className="text-muted-foreground ml-2 text-sm">{p.brand}</span>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => generateTopic(p.id)}
                                disabled={generating !== null}
                            >
                                {generating === p.id ? 'Generating...' : 'Generate Topic'}
                            </Button>
                        </div>
                    ))}
                    {personas.length === 0 && (
                        <p className="text-muted-foreground">No active personas. <Link href="/personas/new" className="underline">Create one</Link>.</p>
                    )}
                </CardContent>
            </Card>

            {/* Recent topics */}
            <h2 className="text-xl font-semibold mb-4">Recent Topics</h2>
            <div className="space-y-3">
                {topics.map(topic => (
                    <Card key={topic.id}>
                        <CardContent className="flex items-center justify-between py-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <Badge className={statusColor[topic.status] || 'bg-gray-500'}>
                                        {topic.status.replace('_', ' ')}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(topic.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                                <p className="font-medium truncate">{topic.title}</p>
                                <p className="text-sm text-muted-foreground truncate">{topic.hook}</p>
                            </div>
                            <div className="flex gap-2 ml-4 shrink-0">
                                {topic.status === 'draft' && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => generateContent(topic.id)}
                                        disabled={generating !== null}
                                    >
                                        {generating === topic.id ? 'Generating...' : 'Generate Content'}
                                    </Button>
                                )}
                                {(topic.status === 'content_ready' || topic.status === 'approved') && (
                                    <Link href={`/review/${topic.id}`}>
                                        <Button size="sm" variant="outline">Review</Button>
                                    </Link>
                                )}
                                {topic.status === 'draft' && (
                                    <Link href={`/review/${topic.id}`}>
                                        <Button size="sm" variant="ghost">View</Button>
                                    </Link>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {topics.length === 0 && (
                    <p className="text-muted-foreground">No topics yet. Generate one above.</p>
                )}
            </div>
        </div>
    );
}
