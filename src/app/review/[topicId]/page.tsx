'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { wordCount, estimateDuration } from '@/lib/utils';
import type { ContentPiece, AudioAsset, VisualAsset, Voice, HistoricalPoint, TopicWithPersona } from '@/types/database';

const TAB_LABELS: Record<string, string> = {
    long: 'Long Video',
    short_1: 'Short 1',
    short_2: 'Short 2',
    short_3: 'Short 3',
    short_4: 'Short 4',
    carousel: 'Carousel',
};

const VIDEO_PIECE_TYPES = ['long', 'short_1', 'short_2', 'short_3', 'short_4'];

export default function ReviewPage() {
    const { topicId } = useParams<{ topicId: string }>();
    const router = useRouter();
    const supabase = useMemo(() => createClient(), []);

    const [topic, setTopic] = useState<TopicWithPersona | null>(null);
    const [pieces, setPieces] = useState<ContentPiece[]>([]);
    const [audioAssets, setAudioAssets] = useState<Record<string, AudioAsset>>({});
    const [visualAssets, setVisualAssets] = useState<Record<string, VisualAsset[]>>({});
    const [voices, setVoices] = useState<Voice[]>([]);
    const [saving, setSaving] = useState<string | null>(null);
    const [generating, setGenerating] = useState<string | null>(null);
    const [dirty, setDirty] = useState<Record<string, Partial<ContentPiece>>>({});
    const [publishDate, setPublishDate] = useState('');
    const [publishTime, setPublishTime] = useState('09:00');
    const [approving, setApproving] = useState(false);
    const [scheduling, setScheduling] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
    const [previewing, setPreviewing] = useState(false);
    const [podcastEpisode, setPodcastEpisode] = useState<{ id: string; title: string; script: string; audio_url: string | null; status: string; duration_seconds: number | null } | null>(null);
    const [generatingPodcast, setGeneratingPodcast] = useState(false);

    const load = useCallback(async () => {
        const [topicRes, piecesRes, podcastRes] = await Promise.all([
            supabase.from('topics').select('*, personas(*)').eq('id', topicId).single(),
            supabase.from('content_pieces').select('*').eq('topic_id', topicId).order('piece_order'),
            supabase.from('podcast_episodes').select('*').eq('topic_id', topicId).limit(1).maybeSingle(),
        ]);
        if (podcastRes.data) setPodcastEpisode(podcastRes.data as typeof podcastEpisode);
        if (topicRes.data) {
            const t = topicRes.data as unknown as TopicWithPersona;
            setTopic(t);
            // Load voices from the persona's voice pool
            if (t.personas?.voice_pool?.length) {
                const { data: voiceData } = await supabase
                    .from('voices')
                    .select('*')
                    .in('id', t.personas.voice_pool)
                    .eq('is_active', true);
                if (voiceData) setVoices(voiceData);
            }
        }
        if (piecesRes.data) {
            setPieces(piecesRes.data);

            const pieceIds = piecesRes.data.map(p => p.id);
            if (pieceIds.length > 0) {
                // Fetch audio assets
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

                // Fetch visual assets
                const { data: visualData } = await supabase
                    .from('visual_assets')
                    .select('*')
                    .in('content_piece_id', pieceIds);

                if (visualData) {
                    const visualMap: Record<string, VisualAsset[]> = {};
                    for (const asset of visualData) {
                        if (!visualMap[asset.content_piece_id]) {
                            visualMap[asset.content_piece_id] = [];
                        }
                        visualMap[asset.content_piece_id].push(asset);
                    }
                    setVisualAssets(visualMap);
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
        try {
            const res = await fetch(`/api/content/${pieceId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            if (!res.ok) {
                toast.error(`Save failed (${res.status})`);
                return;
            }
            const data = await res.json();
            if (!data.success) {
                toast.error(data.error);
                return;
            }
            toast.success('Changes saved');
            setDirty(prev => {
                const next = { ...prev };
                delete next[pieceId];
                return next;
            });
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(null);
        }
    }

    async function callMediaApi(
        pieceId: string, url: string, body: Record<string, unknown>, successMsg: string,
    ) {
        setGenerating(pieceId);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                toast.error(`Request failed (${res.status})`);
                return;
            }
            const data = await res.json();
            if (!data.success) { toast.error(data.error); return data; }
            toast.success(successMsg);
            await load();
            return data;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Request failed');
        } finally {
            setGenerating(null);
        }
    }

    const generateAudio = (pieceId: string) =>
        callMediaApi(pieceId, '/api/media/voice', { contentPieceId: pieceId, voiceId: topic?.voice_id }, 'Audio generated');

    function generateVideo(pieceId: string) {
        if (!topic) return;
        const audio = audioAssets[pieceId];
        if (!audio?.audio_url) { toast.error('Generate audio first before submitting video'); return; }
        const avatarId = topic.personas?.heygen_avatar_id;
        if (!avatarId) { toast.error('No HeyGen avatar configured for this persona'); return; }
        return callMediaApi(pieceId, '/api/media/video', { contentPieceId: pieceId, avatarId, audioUrl: audio.audio_url }, 'Video submitted');
    }

    const generateThumbnail = (pieceId: string) =>
        callMediaApi(pieceId, '/api/media/thumbnail', { contentPieceId: pieceId }, 'Thumbnail generated');

    function generateCarousel(pieceId: string) {
        if (!topic) return;
        const templateId = topic.personas?.canva_carousel_template_id;
        if (!templateId) { toast.error('No Canva carousel template configured for this persona'); return; }
        return callMediaApi(pieceId, '/api/media/carousel', {
            contentPieceId: pieceId, templateId, brandKitId: topic.personas?.canva_brand_kit_id || undefined,
        }, 'Carousel design created');
    }

    async function generateMusic(pieceId: string) {
        const data = await callMediaApi(pieceId, '/api/media/music', { contentPieceId: pieceId }, 'Music generated');
        if (data?.skipped && data.reason) { toast.info(data.reason); }
    }

    const regenerateScript = (pieceId: string) =>
        callMediaApi(pieceId, `/api/content/${pieceId}/regenerate`, {}, 'Script regenerated. Re-generate media to use the new version.');

    const remixField = (pieceId: string, field: string) =>
        callMediaApi(pieceId, `/api/content/${pieceId}/remix`, { field }, `${field.replace('_', ' ')} remixed. Review the new version.`);

    async function changeVoice(voiceId: string) {
        if (!topic) return;
        const { error } = await supabase
            .from('topics')
            .update({ voice_id: voiceId })
            .eq('id', topicId);
        if (error) { toast.error(error.message); return; }
        toast.success('Voice changed. Re-generate audio to use the new voice.');
        await load();
    }

    async function previewVoice(text: string) {
        if (!topic?.voice_id) { toast.error('No voice selected'); return; }
        if (!text.trim()) { toast.error('No text to preview'); return; }
        setPreviewing(true);
        setPreviewAudioUrl(null);
        try {
            const res = await fetch('/api/media/voice-preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.slice(0, 500), voiceId: topic.voice_id }),
            });
            if (!res.ok) { toast.error(`Preview failed (${res.status})`); return; }
            const data = await res.json();
            if (!data.success) { toast.error(data.error); return; }
            setPreviewAudioUrl(data.audioUrl);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Preview failed');
        } finally {
            setPreviewing(false);
        }
    }

    async function generatePodcast() {
        if (!topic) return;
        const brandId = topic.personas?.brand_id;
        if (!brandId) { toast.error('No brand configured for this persona'); return; }
        setGeneratingPodcast(true);
        try {
            const res = await fetch('/api/media/podcast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topicId, brandId }),
            });
            if (!res.ok) { toast.error(`Podcast generation failed (${res.status})`); return; }
            const data = await res.json();
            if (!data.success) { toast.error(data.error); return; }
            toast.success('Podcast generated');
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Podcast generation failed');
        } finally {
            setGeneratingPodcast(false);
        }
    }

    async function approveTopic() {
        setApproving(true);
        try {
            const res = await fetch(`/api/topics/${topicId}/approve`, { method: 'POST' });
            if (!res.ok) { toast.error(`Approval failed (${res.status})`); return; }
            const data = await res.json();
            if (!data.success) { toast.error(data.error); return; }
            toast.success('Topic approved');
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Approval failed');
        } finally {
            setApproving(false);
        }
    }

    async function scheduleTopic() {
        if (!publishDate) { toast.error('Select a publish date'); return; }
        if (publishDate < new Date().toISOString().split('T')[0]) { toast.error('Cannot schedule in the past'); return; }
        setScheduling(true);
        try {
            const res = await fetch(`/api/topics/${topicId}/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publishDate, publishTime }),
            });
            if (!res.ok) { toast.error(`Scheduling failed (${res.status})`); return; }
            const data = await res.json();
            if (!data.success) { toast.error(data.error); return; }
            toast.success(`Scheduled for ${publishDate} at ${publishTime}`);
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Scheduling failed');
        } finally {
            setScheduling(false);
        }
    }

    async function publishNow() {
        setPublishing(true);
        try {
            const res = await fetch(`/api/topics/${topicId}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: false }),
            });
            if (!res.ok) { toast.error(`Publishing failed (${res.status})`); return; }
            const data = await res.json();
            if (!data.success) { toast.error(data.error); return; }
            toast.success(`Publishing started — ${data.piecesProcessed} pieces submitted`);
            if (data.warnings && data.warnings.length > 0) {
                for (const warning of data.warnings as string[]) {
                    toast.warning(warning);
                }
            }
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Publishing failed');
        } finally {
            setPublishing(false);
        }
    }

    if (!topic) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
            </div>
        );
    }

    const points = topic.historical_points as HistoricalPoint[];

    const statusColors: Record<string, string> = {
        content_ready: 'bg-green-600',
        approved: 'bg-emerald-600',
        scheduled: 'bg-purple-600',
        publishing: 'bg-blue-600',
        partially_published: 'bg-orange-600',
        published: 'bg-gray-600',
        failed: 'bg-red-600',
    };

    return (
        <div className="container max-w-screen-lg py-8">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold">{topic.title}</h1>
                    <p className="text-muted-foreground mt-1">{topic.hook}</p>
                </div>
                <div className="flex items-center gap-3">
                    {voices.length > 0 && (
                        <select
                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={topic.voice_id}
                            onChange={e => changeVoice(e.target.value)}
                        >
                            {voices.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                    )}
                    <Badge className={statusColors[topic.status] || 'bg-yellow-600'}>
                        {topic.status.replace('_', ' ')}
                    </Badge>
                    <Button variant="outline" onClick={() => router.push('/plan')}>Back to Plan</Button>
                </div>
            </div>

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
                        <TabsTrigger value="podcast">
                            Podcast
                            {podcastEpisode?.audio_url && <span className="ml-1 text-green-500">*</span>}
                        </TabsTrigger>
                    </TabsList>

                    {pieces.map(piece => {
                        const currentScript = dirty[piece.id]?.script as string ?? piece.script ?? '';
                        const currentCaptionLong = dirty[piece.id]?.caption_long as string ?? piece.caption_long ?? '';
                        const currentCaptionShort = dirty[piece.id]?.caption_short as string ?? piece.caption_short ?? '';
                        const words = wordCount(currentScript);
                        const isVideoPiece = VIDEO_PIECE_TYPES.includes(piece.piece_type);
                        const audio = audioAssets[piece.id];
                        const pieceVisuals = visualAssets[piece.id] || [];
                        const carouselImages = pieceVisuals.filter(v => v.asset_type === 'carousel_image');
                        const isCarousel = piece.piece_type === 'carousel';
                        const musicIsUrl = piece.music_track?.startsWith('http');

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
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => remixField(piece.id, 'script')}
                                                    disabled={generating === piece.id}
                                                >
                                                    {generating === piece.id ? 'Remixing...' : 'Remix Script'}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => regenerateScript(piece.id)}
                                                    disabled={generating === piece.id}
                                                >
                                                    {generating === piece.id ? 'Regenerating...' : 'Regenerate All'}
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => previewVoice(currentScript)}
                                                    disabled={previewing || !currentScript}
                                                >
                                                    {previewing ? 'Previewing...' : 'Preview Voice'}
                                                </Button>
                                            </div>
                                            {previewAudioUrl && (
                                                <audio controls className="w-full mt-2" src={previewAudioUrl}>
                                                    <track kind="captions" />
                                                </audio>
                                            )}
                                        </div>

                                        <Separator />

                                        {/* Captions */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Caption (Long) <span className="text-xs text-muted-foreground">{currentCaptionLong.length}/2200</span></Label>
                                                <Textarea
                                                    rows={5}
                                                    maxLength={2200}
                                                    value={currentCaptionLong}
                                                    onChange={e => updateField(piece.id, 'caption_long', e.target.value)}
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => remixField(piece.id, 'caption_long')}
                                                    disabled={generating === piece.id}
                                                >
                                                    {generating === piece.id ? 'Remixing...' : 'Remix'}
                                                </Button>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Caption (Short) <span className="text-xs text-muted-foreground">{currentCaptionShort.length}/280</span></Label>
                                                <Textarea
                                                    rows={5}
                                                    maxLength={280}
                                                    value={currentCaptionShort}
                                                    onChange={e => updateField(piece.id, 'caption_short', e.target.value)}
                                                />
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => remixField(piece.id, 'caption_short')}
                                                    disabled={generating === piece.id}
                                                >
                                                    {generating === piece.id ? 'Remixing...' : 'Remix'}
                                                </Button>
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
                                                            <Badge variant="outline" className="bg-red-600/20 text-red-400" title={piece.error_message || ''}>Failed</Badge>
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

                                        {/* Thumbnail */}
                                        {piece.thumbnail_prompt && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label>Thumbnail</Label>
                                                        {piece.thumbnail_url ? (
                                                            <Badge variant="outline" className="bg-green-600/20 text-green-400">Ready</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-muted">Not generated</Badge>
                                                        )}
                                                    </div>
                                                    {piece.thumbnail_url ? (
                                                        <img
                                                            src={piece.thumbnail_url}
                                                            alt="Thumbnail"
                                                            className="w-full max-w-md rounded-md border"
                                                        />
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => generateThumbnail(piece.id)}
                                                            disabled={generating === piece.id}
                                                        >
                                                            {generating === piece.id ? 'Generating...' : 'Generate Thumbnail'}
                                                        </Button>
                                                    )}
                                                    <div className="flex items-start gap-2">
                                                        <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md flex-1">{piece.thumbnail_prompt}</p>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="shrink-0"
                                                            onClick={() => remixField(piece.id, 'thumbnail_prompt')}
                                                            disabled={generating === piece.id}
                                                        >
                                                            {generating === piece.id ? 'Remixing...' : 'Remix Prompt'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* Carousel slides */}
                                        {isCarousel && piece.carousel_slides && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <Label>Carousel Slides</Label>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => remixField(piece.id, 'carousel_slides')}
                                                                disabled={generating === piece.id}
                                                            >
                                                                {generating === piece.id ? 'Remixing...' : 'Remix Slides'}
                                                            </Button>
                                                        </div>
                                                        {piece.canva_design_id ? (
                                                            <Badge variant="outline" className="bg-green-600/20 text-green-400">Design Created</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-muted">No design</Badge>
                                                        )}
                                                    </div>
                                                    <div className="grid gap-2">
                                                        {(piece.carousel_slides as Array<{ slide: number; text: string; imagePrompt: string }>).map(slide => {
                                                            const slideImage = carouselImages.find(
                                                                v => (v.metadata as Record<string, unknown>)?.slide === slide.slide,
                                                            );
                                                            return (
                                                                <div key={slide.slide} className="bg-muted rounded-md p-3">
                                                                    <p className="text-xs text-muted-foreground mb-1">Slide {slide.slide}</p>
                                                                    {slideImage?.asset_url && (
                                                                        <img
                                                                            src={slideImage.asset_url}
                                                                            alt={`Slide ${slide.slide}`}
                                                                            className="w-full max-w-xs rounded-md border mb-2"
                                                                        />
                                                                    )}
                                                                    <p className="text-sm font-medium">{slide.text}</p>
                                                                    <p className="text-xs text-muted-foreground mt-1 italic">{slide.imagePrompt}</p>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    {/* Carousel design actions */}
                                                    {piece.carousel_url ? (
                                                        <img
                                                            src={piece.carousel_url}
                                                            alt="Exported carousel"
                                                            className="w-full max-w-md rounded-md border"
                                                        />
                                                    ) : !piece.canva_design_id ? (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => generateCarousel(piece.id)}
                                                            disabled={generating === piece.id}
                                                        >
                                                            {generating === piece.id ? 'Creating...' : 'Generate Carousel Design'}
                                                        </Button>
                                                    ) : null}

                                                    {piece.canva_design_id && (
                                                        <p className="text-xs text-muted-foreground">
                                                            Canva Design ID: {piece.canva_design_id}
                                                        </p>
                                                    )}
                                                </div>
                                            </>
                                        )}

                                        {/* Music (carousel + video pieces) */}
                                        {(isCarousel || isVideoPiece) && (
                                            <>
                                                <Separator />
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label>Background Music</Label>
                                                        {musicIsUrl ? (
                                                            <Badge variant="outline" className="bg-green-600/20 text-green-400">Ready</Badge>
                                                        ) : piece.music_track ? (
                                                            <Badge variant="outline" className="bg-muted">Mood: {piece.music_track}</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="bg-muted">Not set</Badge>
                                                        )}
                                                    </div>
                                                    {musicIsUrl ? (
                                                        <audio controls className="w-full" src={piece.music_track!}>
                                                            <track kind="captions" />
                                                        </audio>
                                                    ) : (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => generateMusic(piece.id)}
                                                            disabled={generating === piece.id}
                                                        >
                                                            {generating === piece.id ? 'Generating...' : 'Generate Music'}
                                                        </Button>
                                                    )}
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

                    {/* Podcast Tab */}
                    <TabsContent value="podcast">
                        <Card>
                            <CardContent className="space-y-4 pt-6">
                                {podcastEpisode ? (
                                    <>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label>Podcast Script</Label>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        {wordCount(podcastEpisode.script || '')} words
                                                        {podcastEpisode.duration_seconds && ` / ${Math.floor(podcastEpisode.duration_seconds / 60)}:${String(podcastEpisode.duration_seconds % 60).padStart(2, '0')}`}
                                                    </span>
                                                    <Badge variant="outline" className={
                                                        podcastEpisode.status === 'ready' || podcastEpisode.status === 'published'
                                                            ? 'bg-green-600/20 text-green-400'
                                                            : podcastEpisode.status === 'generating'
                                                            ? 'bg-blue-600/20 text-blue-400'
                                                            : podcastEpisode.status === 'error'
                                                            ? 'bg-red-600/20 text-red-400'
                                                            : 'bg-muted'
                                                    }>
                                                        {podcastEpisode.status}
                                                    </Badge>
                                                </div>
                                            </div>
                                            <Textarea
                                                rows={16}
                                                value={podcastEpisode.script || ''}
                                                readOnly
                                                className="font-mono text-sm"
                                            />
                                        </div>

                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => previewVoice(podcastEpisode.script || '')}
                                                disabled={previewing || !podcastEpisode.script}
                                            >
                                                {previewing ? 'Previewing...' : 'Preview Voice'}
                                            </Button>
                                            {!podcastEpisode.audio_url && (
                                                <Button
                                                    size="sm"
                                                    onClick={generatePodcast}
                                                    disabled={generatingPodcast}
                                                >
                                                    {generatingPodcast ? 'Generating...' : 'Generate Podcast Audio'}
                                                </Button>
                                            )}
                                        </div>

                                        {previewAudioUrl && (
                                            <div className="space-y-1">
                                                <Label className="text-xs text-muted-foreground">Voice Preview (first 500 chars)</Label>
                                                <audio controls className="w-full" src={previewAudioUrl}>
                                                    <track kind="captions" />
                                                </audio>
                                            </div>
                                        )}

                                        {podcastEpisode.audio_url && (
                                            <div className="space-y-1">
                                                <Label>Full Podcast Audio</Label>
                                                <audio controls className="w-full" src={podcastEpisode.audio_url}>
                                                    <track kind="captions" />
                                                </audio>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="text-center py-8">
                                        <p className="text-muted-foreground mb-4">No podcast episode for this topic yet.</p>
                                        <Button
                                            onClick={generatePodcast}
                                            disabled={generatingPodcast}
                                        >
                                            {generatingPodcast ? 'Generating...' : 'Generate Podcast'}
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}

            {/* Approve & Schedule */}
            {pieces.length > 0 && (
                <Card className="mt-6">
                    <CardHeader><CardTitle>Approve & Schedule</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        {topic.status === 'content_ready' && (
                            <div className="flex items-center gap-4">
                                <Button onClick={approveTopic} disabled={approving}>
                                    {approving ? 'Approving...' : 'Approve Topic'}
                                </Button>
                                <p className="text-sm text-muted-foreground">
                                    Mark all content as reviewed and approved.
                                </p>
                            </div>
                        )}

                        {topic.status === 'approved' && (
                            <div className="flex items-center gap-4">
                                <input
                                    type="date"
                                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                    value={publishDate}
                                    onChange={e => setPublishDate(e.target.value)}
                                    min={new Date().toISOString().split('T')[0]}
                                />
                                <input
                                    type="time"
                                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                    value={publishTime}
                                    onChange={e => setPublishTime(e.target.value)}
                                />
                                <Button onClick={scheduleTopic} disabled={scheduling || !publishDate}>
                                    {scheduling ? 'Scheduling...' : 'Schedule'}
                                </Button>
                            </div>
                        )}

                        {topic.status === 'scheduled' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Badge className="bg-purple-600">Scheduled</Badge>
                                    <p className="text-sm">
                                        Publishing on {topic.publish_date} at {topic.publish_time}
                                    </p>
                                    <Button
                                        size="sm"
                                        onClick={publishNow}
                                        disabled={publishing}
                                    >
                                        {publishing ? 'Publishing...' : 'Publish Now'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {topic.status === 'publishing' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Badge className="bg-blue-600">Publishing...</Badge>
                                    <p className="text-sm text-muted-foreground">
                                        Content is being distributed to platforms. Status updates every 10 minutes.
                                    </p>
                                </div>
                                {pieces.map(piece => {
                                    const platforms = (piece.published_platforms || {}) as Record<string, { status: string; error?: string }>;
                                    const entries = Object.entries(platforms);
                                    if (entries.length === 0) return null;
                                    return (
                                        <div key={piece.id} className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">{TAB_LABELS[piece.piece_type] || piece.piece_type}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {entries.map(([platform, ps]) => (
                                                    <Badge
                                                        key={platform}
                                                        variant="outline"
                                                        className={
                                                            ps.status === 'published' ? 'bg-green-600/20 text-green-400' :
                                                            ps.status === 'failed' ? 'bg-red-600/20 text-red-400' :
                                                            'bg-yellow-600/20 text-yellow-400'
                                                        }
                                                        title={ps.error || ''}
                                                    >
                                                        {platform}: {ps.status}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {topic.status === 'partially_published' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Badge className="bg-orange-600">Partially Published</Badge>
                                    <p className="text-sm text-muted-foreground">
                                        {topic.error_message || 'Some platforms failed.'}
                                    </p>
                                    <Button
                                        size="sm"
                                        onClick={publishNow}
                                        disabled={publishing}
                                    >
                                        {publishing ? 'Retrying...' : 'Retry Failed'}
                                    </Button>
                                </div>
                                {pieces.map(piece => {
                                    const platforms = (piece.published_platforms || {}) as Record<string, { status: string; error?: string }>;
                                    const entries = Object.entries(platforms);
                                    if (entries.length === 0) return null;
                                    return (
                                        <div key={piece.id} className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">{TAB_LABELS[piece.piece_type] || piece.piece_type}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {entries.map(([platform, ps]) => (
                                                    <Badge
                                                        key={platform}
                                                        variant="outline"
                                                        className={
                                                            ps.status === 'published' ? 'bg-green-600/20 text-green-400' :
                                                            ps.status === 'failed' ? 'bg-red-600/20 text-red-400' :
                                                            'bg-yellow-600/20 text-yellow-400'
                                                        }
                                                        title={ps.error || ''}
                                                    >
                                                        {platform}: {ps.status}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {topic.status === 'failed' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Badge className="bg-red-600">Failed</Badge>
                                    <p className="text-sm text-muted-foreground">
                                        {topic.error_message || 'Publishing failed.'}
                                    </p>
                                    <Button
                                        size="sm"
                                        onClick={publishNow}
                                        disabled={publishing}
                                    >
                                        {publishing ? 'Retrying...' : 'Retry Publish'}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {topic.status === 'published' && (
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Badge className="bg-gray-600">Published</Badge>
                                    <p className="text-sm text-muted-foreground">
                                        Published {topic.published_at ? new Date(topic.published_at).toLocaleDateString() : ''}
                                    </p>
                                </div>
                                {pieces.map(piece => {
                                    const platforms = (piece.published_platforms || {}) as Record<string, { status: string; error?: string }>;
                                    const entries = Object.entries(platforms);
                                    if (entries.length === 0) return null;
                                    return (
                                        <div key={piece.id} className="space-y-1">
                                            <p className="text-xs font-medium text-muted-foreground">{TAB_LABELS[piece.piece_type] || piece.piece_type}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {entries.map(([platform, ps]) => (
                                                    <Badge
                                                        key={platform}
                                                        variant="outline"
                                                        className={
                                                            ps.status === 'published' ? 'bg-green-600/20 text-green-400' :
                                                            'bg-red-600/20 text-red-400'
                                                        }
                                                    >
                                                        {platform}: {ps.status}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
