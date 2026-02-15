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
import { wordCount, estimateDuration } from '@/lib/utils';
import type { Topic, ContentPiece, AudioAsset, HistoricalPoint, Persona } from '@/types/database';

const TAB_LABELS: Record<string, string> = {
    long: 'Long Video',
    short_1: 'Short 1',
    short_2: 'Short 2',
    short_3: 'Short 3',
    short_4: 'Short 4',
    carousel: 'Carousel',
};

const VIDEO_PIECE_TYPES = ['long', 'short_1', 'short_2', 'short_3', 'short_4'];

interface TopicWithPersona extends Topic {
    personas: Persona;
}

export default function ReviewPage() {
    const { topicId } = useParams<{ topicId: string }>();
    const router = useRouter();
    const supabase = createClient();

    const [topic, setTopic] = useState<TopicWithPersona | null>(null);
    const [pieces, setPieces] = useState<ContentPiece[]>([]);
    const [audioAssets, setAudioAssets] = useState<Record<string, AudioAsset>>({});
    const [saving, setSaving] = useState<string | null>(null);
    const [generating, setGenerating] = useState<string | null>(null);
    const [dirty, setDirty] = useState<Record<string, Partial<ContentPiece>>>({});
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [topicRes, piecesRes] = await Promise.all([
            supabase.from('topics').select('*, personas(*)').eq('id', topicId).single(),
            supabase.from('content_pieces').select('*').eq('topic_id', topicId).order('piece_order'),
        ]);
        if (topicRes.data) setTopic(topicRes.data as unknown as TopicWithPersona);
        if (piecesRes.data) {
            setPieces(piecesRes.data);

            // Fetch audio assets for all pieces
            const pieceIds = piecesRes.data.map(p => p.id);
            if (pieceIds.length > 0) {
                const { data: audioData } = await supabase
                    .from('audio_assets')
                    .select('*')
                    .in('content_piece_id', pieceIds)
                    .eq('status', 'ready');

                if (audioData) {
                    const audioMap: Record<string, AudioAsset> = {};
                    for (const asset of audioData) {
                        audioMap[asset.content_piece_id] = asset;
                    }
                    setAudioAssets(audioMap);
                }
            }
        }
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

    async function generateAudio(pieceId: string) {
        if (!topic) return;
        setGenerating(pieceId);
        setError(null);
        try {
            const res = await fetch('/api/media/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contentPieceId: pieceId,
                    voiceId: topic.voice_id,
                }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error);
                return;
            }
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Audio generation failed');
        } finally {
            setGenerating(null);
        }
    }

    async function generateVideo(pieceId: string) {
        if (!topic) return;
        const audio = audioAssets[pieceId];
        if (!audio?.audio_url) {
            setError('Generate audio first before submitting video');
            return;
        }
        const avatarId = topic.personas?.heygen_avatar_id;
        if (!avatarId) {
            setError('No HeyGen avatar configured for this persona');
            return;
        }
        setGenerating(pieceId);
        setError(null);
        try {
            const res = await fetch('/api/media/video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contentPieceId: pieceId,
                    avatarId,
                    audioUrl: audio.audio_url,
                }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error);
                return;
            }
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Video generation failed');
        } finally {
            setGenerating(null);
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
                        const isVideoPiece = VIDEO_PIECE_TYPES.includes(piece.piece_type);
                        const audio = audioAssets[piece.id];

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

                                        {/* Audio Preview + Generation (video pieces only) */}
                                        {isVideoPiece && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label>Audio (ElevenLabs TTS)</Label>
                                                        {audio ? (
                                                            <Badge variant="outline" className="bg-green-600/20 text-green-400">Ready</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-muted">Not generated</Badge>
                                                        )}
                                                    </div>
                                                    {audio?.audio_url ? (
                                                        <audio controls className="w-full" src={audio.audio_url}>
                                                            <track kind="captions" />
                                                        </audio>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => generateAudio(piece.id)}
                                                            disabled={generating === piece.id}
                                                        >
                                                            {generating === piece.id ? 'Generating...' : 'Generate Audio'}
                                                        </Button>
                                                    )}
                                                </div>
                                            </>
                                        )}

                                        {/* Video Preview + Generation (video pieces only) */}
                                        {isVideoPiece && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label>Video (HeyGen Avatar)</Label>
                                                        {piece.heygen_status === 'done' && (
                                                            <Badge variant="outline" className="bg-green-600/20 text-green-400">Done</Badge>
                                                        )}
                                                        {piece.heygen_status === 'processing' && (
                                                            <Badge variant="outline" className="bg-yellow-600/20 text-yellow-400">Processing</Badge>
                                                        )}
                                                        {piece.heygen_status === 'failed' && (
                                                            <Badge variant="outline" className="bg-red-600/20 text-red-400">Failed</Badge>
                                                        )}
                                                        {!piece.heygen_status && (
                                                            <Badge variant="outline" className="bg-muted">Not submitted</Badge>
                                                        )}
                                                    </div>
                                                    {piece.video_url ? (
                                                        <video controls className="w-full max-h-96 rounded-md" src={piece.video_url}>
                                                            <track kind="captions" />
                                                        </video>
                                                    ) : audio?.audio_url ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => generateVideo(piece.id)}
                                                            disabled={generating === piece.id || piece.heygen_status === 'processing'}
                                                        >
                                                            {piece.heygen_status === 'processing'
                                                                ? 'Video rendering...'
                                                                : generating === piece.id
                                                                    ? 'Submitting...'
                                                                    : 'Generate Video'}
                                                        </Button>
                                                    ) : (
                                                        <p className="text-xs text-muted-foreground">Generate audio first</p>
                                                    )}
                                                </div>
                                            </>
                                        )}

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
