'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import type { Topic, ContentPiece, HistoricalPoint } from '@/types/database';

const TAB_LABELS: Record<string, string> = {
    long: 'Long Video',
    short_1: 'Short 1',
    short_2: 'Short 2',
    short_3: 'Short 3',
    short_4: 'Short 4',
    carousel: 'Carousel',
};

function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateDuration(words: number): string {
    const minutes = words / 150; // ~150 wpm speaking rate
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    return `${minutes.toFixed(1)} min`;
}

export default function ReviewPage() {
    const { topicId } = useParams<{ topicId: string }>();
    const router = useRouter();
    const supabase = createClient();

    const [topic, setTopic] = useState<Topic | null>(null);
    const [pieces, setPieces] = useState<ContentPiece[]>([]);
    const [saving, setSaving] = useState<string | null>(null);
    const [dirty, setDirty] = useState<Record<string, Partial<ContentPiece>>>({});
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [topicRes, piecesRes] = await Promise.all([
            supabase.from('topics').select('*').eq('id', topicId).single(),
            supabase.from('content_pieces').select('*').eq('topic_id', topicId).order('piece_order'),
        ]);
        if (topicRes.data) setTopic(topicRes.data);
        if (piecesRes.data) setPieces(piecesRes.data);
    }, [supabase, topicId]);

    useEffect(() => { load(); }, [load]);

    function updateField(pieceId: string, field: string, value: string) {
        setDirty(prev => ({
            ...prev,
            [pieceId]: { ...prev[pieceId], [field]: value },
        }));
    }

    async function savePiece(pieceId: string) {
        const updates = dirty[pieceId];
        if (!updates) return;

        setSaving(pieceId);
        setError(null);
        try {
            const res = await fetch(`/api/content/${pieceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error);
                return;
            }
            // Clear dirty state and refresh
            setDirty(prev => {
                const next = { ...prev };
                delete next[pieceId];
                return next;
            });
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(null);
        }
    }

    if (!topic) {
        return <div className="container py-8 text-muted-foreground">Loading...</div>;
    }

    const points = topic.historical_points as HistoricalPoint[];

    return (
        <div className="container max-w-screen-lg py-8">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">{topic.title}</h1>
                    <p className="text-muted-foreground mt-1">{topic.hook}</p>
                </div>
                <div className="flex items-center gap-3">
                    <Badge className={topic.status === 'content_ready' ? 'bg-green-600' : 'bg-yellow-600'}>
                        {topic.status.replace('_', ' ')}
                    </Badge>
                    <Button variant="outline" onClick={() => router.push('/plan')}>Back to Plan</Button>
                </div>
            </div>

            {error && (
                <div className="bg-destructive/20 border border-destructive rounded-md p-3 mb-4">{error}</div>
            )}

            {/* Historical Points */}
            <Card className="mb-6">
                <CardHeader><CardTitle>Historical Points</CardTitle></CardHeader>
                <CardContent>
                    <div className="grid gap-3">
                        {points.map(p => (
                            <div key={p.point} className="flex gap-3">
                                <Badge variant="outline" className="shrink-0 h-6 w-6 flex items-center justify-center">{p.point}</Badge>
                                <div>
                                    <p className="text-sm font-medium">{p.claim}</p>
                                    <p className="text-xs text-muted-foreground">{p.source} ({p.year})</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Content Pieces */}
            {pieces.length === 0 ? (
                <p className="text-muted-foreground">No content pieces yet. Generate content from the Plan page.</p>
            ) : (
                <Tabs defaultValue={pieces[0]?.piece_type || 'long'}>
                    <TabsList className="mb-4">
                        {pieces.map(p => (
                            <TabsTrigger key={p.piece_type} value={p.piece_type}>
                                {TAB_LABELS[p.piece_type] || p.piece_type}
                                {dirty[p.id] && <span className="ml-1 text-yellow-500">*</span>}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    {pieces.map(piece => {
                        const currentScript = dirty[piece.id]?.script as string ?? piece.script ?? '';
                        const currentCaptionLong = dirty[piece.id]?.caption_long as string ?? piece.caption_long ?? '';
                        const currentCaptionShort = dirty[piece.id]?.caption_short as string ?? piece.caption_short ?? '';
                        const words = wordCount(currentScript);

                        return (
                            <TabsContent key={piece.id} value={piece.piece_type}>
                                <Card>
                                    <CardContent className="space-y-4 pt-6">
                                        {/* Script */}
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label>Script</Label>
                                                <span className="text-xs text-muted-foreground">
                                                    {words} words / ~{estimateDuration(words)}
                                                </span>
                                            </div>
                                            <Textarea
                                                rows={piece.piece_type === 'long' ? 16 : 6}
                                                value={currentScript}
                                                onChange={e => updateField(piece.id, 'script', e.target.value)}
                                            />
                                        </div>

                                        <Separator />

                                        {/* Captions */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Caption (Long) <span className="text-xs text-muted-foreground">{currentCaptionLong.length}/2200</span></Label>
                                                <Textarea
                                                    rows={5}
                                                    value={currentCaptionLong}
                                                    onChange={e => updateField(piece.id, 'caption_long', e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Caption (Short) <span className="text-xs text-muted-foreground">{currentCaptionShort.length}/280</span></Label>
                                                <Textarea
                                                    rows={5}
                                                    value={currentCaptionShort}
                                                    onChange={e => updateField(piece.id, 'caption_short', e.target.value)}
                                                />
                                            </div>
                                        </div>

                                        {/* Thumbnail prompt */}
                                        {piece.thumbnail_prompt && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <Label>Thumbnail Prompt</Label>
                                                    <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md">{piece.thumbnail_prompt}</p>
                                                </div>
                                            </>
                                        )}

                                        {/* Carousel slides */}
                                        {piece.piece_type === 'carousel' && piece.carousel_slides && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <Label>Carousel Slides</Label>
                                                    <div className="grid gap-2">
                                                        {(piece.carousel_slides as Array<{ slide: number; text: string; imagePrompt: string }>).map(slide => (
                                                            <div key={slide.slide} className="bg-muted rounded-md p-3">
                                                                <p className="text-xs text-muted-foreground mb-1">Slide {slide.slide}</p>
                                                                <p className="text-sm font-medium">{slide.text}</p>
                                                                <p className="text-xs text-muted-foreground mt-1 italic">{slide.imagePrompt}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* Save button */}
                                        <div className="flex justify-end pt-2">
                                            <Button
                                                onClick={() => savePiece(piece.id)}
                                                disabled={!dirty[piece.id] || saving === piece.id}
                                            >
                                                {saving === piece.id ? 'Saving...' : 'Save Changes'}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        );
                    })}
                </Tabs>
            )}
        </div>
    );
}
