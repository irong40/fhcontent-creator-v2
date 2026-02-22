'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PersonaSwitcher } from '@/components/persona-switcher';
import { QuickPostDialog } from '@/components/quick-post-dialog';
import type { Persona, Topic } from '@/types/database';

export default function PlanPage() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const router = useRouter();
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [generating, setGenerating] = useState<string | null>(null);

    const selectedPersonaId = searchParams.get('persona');

    const setSelectedPersona = useCallback((id: string | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (id) {
            params.set('persona', id);
        } else {
            params.delete('persona');
        }
        router.push(`/plan?${params.toString()}`);
    }, [searchParams, router]);

    useEffect(() => {
        async function load() {
            const [personasRes, topicsRes] = await Promise.all([
                supabase.from('personas').select('*').eq('is_active', true),
                supabase.from('topics').select('*').order('created_at', { ascending: false }).limit(50),
            ]);
            if (personasRes.data) setPersonas(personasRes.data);
            if (topicsRes.data) setTopics(topicsRes.data);
        }
        load();
    }, [supabase]);

    const filteredTopics = selectedPersonaId
        ? topics.filter(t => t.persona_id === selectedPersonaId)
        : topics;

    const personaName = (personaId: string) =>
        personas.find(p => p.id === personaId)?.name ?? '';

    async function generateTopic(personaId: string) {
        setGenerating(personaId);
        try {
            const res = await fetch('/api/topics/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ personaId, count: 1 }),
            });
            if (!res.ok) {
                toast.error(`Topic generation failed (${res.status})`);
                return;
            }
            const data = await res.json();
            if (!data.success) {
                toast.error(data.error || 'Topic generation failed');
                return;
            }
            toast.success('Topic generated');
            const { data: refreshed } = await supabase
                .from('topics')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);
            if (refreshed) setTopics(refreshed);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setGenerating(null);
        }
    }

    async function generateContent(topicId: string) {
        setGenerating(topicId);
        try {
            const res = await fetch('/api/content/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topicId }),
            });
            if (!res.ok) {
                toast.error(`Content generation failed (${res.status})`);
                return;
            }
            const data = await res.json();
            if (!data.success) {
                toast.error(data.error || 'Content generation failed');
                return;
            }
            toast.success('Content generated — ready for review');
            const { data: refreshed } = await supabase
                .from('topics')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);
            if (refreshed) setTopics(refreshed);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unknown error');
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
        publishing: 'bg-blue-600',
        published: 'bg-gray-600',
        failed: 'bg-red-600',
    };

    return (
        <div className="container max-w-screen-lg py-8">
            <h1 className="text-3xl font-bold mb-6">Content Plan</h1>

            {personas.length > 1 && (
                <div className="mb-6">
                    <PersonaSwitcher
                        personas={personas}
                        selectedId={selectedPersonaId}
                        onSelect={setSelectedPersona}
                    />
                </div>
            )}

            {/* Quick Post */}
            <Card className="mb-4">
                <CardContent className="flex items-center justify-between py-4">
                    <div>
                        <p className="font-medium">Quick Post</p>
                        <p className="text-sm text-muted-foreground">
                            Post a one-off to social platforms without the full pipeline
                        </p>
                    </div>
                    <QuickPostDialog
                        trigger={<Button variant="outline" size="sm">Quick Post</Button>}
                    />
                </CardContent>
            </Card>

            {/* Persona actions */}
            <Card className="mb-8">
                <CardHeader>
                    <CardTitle>Generate Topics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {personas
                        .filter(p => !selectedPersonaId || p.id === selectedPersonaId)
                        .map(p => (
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
            <h2 className="text-xl font-semibold mb-4">
                Recent Topics
                {selectedPersonaId && (
                    <span className="text-muted-foreground text-base font-normal ml-2">
                        ({filteredTopics.length})
                    </span>
                )}
            </h2>
            <div className="space-y-3">
                {filteredTopics.map(topic => (
                    <Card key={topic.id}>
                        <CardContent className="flex items-center justify-between py-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <Badge className={statusColor[topic.status] || 'bg-gray-500'}>
                                        {topic.status.replace('_', ' ')}
                                    </Badge>
                                    {!selectedPersonaId && personas.length > 1 && (
                                        <span className="text-xs text-amber-500 font-medium">
                                            {personaName(topic.persona_id)}
                                        </span>
                                    )}
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
                                {(['content_ready', 'approved', 'scheduled', 'publishing', 'published'].includes(topic.status)) && (
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
                {filteredTopics.length === 0 && (
                    <p className="text-muted-foreground">
                        {selectedPersonaId ? 'No topics for this persona.' : 'No topics yet. Generate one above.'}
                    </p>
                )}
            </div>
        </div>
    );
}
