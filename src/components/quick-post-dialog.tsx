'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { Persona } from '@/types/database';

const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'threads', 'twitter', 'bluesky'] as const;

export function QuickPostDialog({ trigger }: { trigger: React.ReactNode }) {
    const supabase = useMemo(() => createClient(), []);
    const [open, setOpen] = useState(false);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [personaId, setPersonaId] = useState('');
    const [text, setText] = useState('');
    const [expandWithAI, setExpandWithAI] = useState(true);
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
    const [addImage, setAddImage] = useState(false);
    const [imagePrompt, setImagePrompt] = useState('');
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        if (!open) return;
        async function load() {
            const { data } = await supabase.from('personas').select('*').eq('is_active', true);
            if (data && data.length > 0) {
                setPersonas(data);
                if (!personaId) setPersonaId(data[0].id);
            }
        }
        load();
    }, [open, supabase, personaId]);

    const selectedPersona = personas.find(p => p.id === personaId);
    const availablePlatforms = selectedPersona
        ? PLATFORMS.filter(p => {
            const accounts = (selectedPersona.platform_accounts || {}) as Record<string, string>;
            return !!accounts[p];
        })
        : [];

    function togglePlatform(platform: string) {
        setSelectedPlatforms(prev =>
            prev.includes(platform)
                ? prev.filter(p => p !== platform)
                : [...prev, platform]
        );
    }

    async function handlePost() {
        if (!text.trim()) { toast.error('Write something first'); return; }
        if (selectedPlatforms.length === 0) { toast.error('Select at least one platform'); return; }

        setPosting(true);
        try {
            const res = await fetch('/api/content/quick-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    personaId,
                    text: text.trim(),
                    platforms: selectedPlatforms,
                    expandWithAI,
                    imagePrompt: addImage && imagePrompt.trim() ? imagePrompt.trim() : undefined,
                }),
            });

            const data = await res.json();
            if (!data.success) {
                toast.error(data.error || 'Quick post failed');
                return;
            }

            const successes = Object.entries(data.results as Record<string, { postId?: string; error?: string }>)
                .filter(([, r]) => r.postId).length;
            const failures = Object.entries(data.results as Record<string, { postId?: string; error?: string }>)
                .filter(([, r]) => r.error).length;

            if (failures > 0) {
                toast.warning(`Posted to ${successes} platforms, ${failures} failed`);
            } else {
                toast.success(`Posted to ${successes} platforms`);
            }

            // Reset form
            setText('');
            setImagePrompt('');
            setAddImage(false);
            setSelectedPlatforms([]);
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setPosting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Quick Post</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    {/* Persona selector */}
                    {personas.length > 1 && (
                        <div className="space-y-1">
                            <Label>Persona</Label>
                            <Select value={personaId} onValueChange={(v) => { setPersonaId(v); setSelectedPlatforms([]); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {personas.map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {/* Caption / idea */}
                    <div className="space-y-1">
                        <Label>Caption or idea</Label>
                        <Textarea
                            placeholder="What's on your mind?"
                            value={text}
                            onChange={e => setText(e.target.value)}
                            rows={4}
                        />
                        <div className="flex items-center gap-2 mt-1">
                            <button
                                type="button"
                                onClick={() => setExpandWithAI(!expandWithAI)}
                                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                    expandWithAI
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-muted text-muted-foreground border-border'
                                }`}
                            >
                                {expandWithAI ? 'AI Expand: ON' : 'AI Expand: OFF'}
                            </button>
                            <span className="text-xs text-muted-foreground">
                                {expandWithAI ? 'Claude will expand your idea' : 'Post as-is'}
                            </span>
                        </div>
                    </div>

                    {/* Platform selection */}
                    <div className="space-y-1">
                        <Label>Platforms</Label>
                        <div className="flex flex-wrap gap-2">
                            {availablePlatforms.map(platform => (
                                <Badge
                                    key={platform}
                                    variant={selectedPlatforms.includes(platform) ? 'default' : 'outline'}
                                    className="cursor-pointer select-none"
                                    onClick={() => togglePlatform(platform)}
                                >
                                    {platform}
                                </Badge>
                            ))}
                            {availablePlatforms.length === 0 && (
                                <span className="text-xs text-muted-foreground">No platform accounts configured</span>
                            )}
                        </div>
                    </div>

                    {/* Image generation */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setAddImage(!addImage)}
                                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                                    addImage
                                        ? 'bg-primary text-primary-foreground border-primary'
                                        : 'bg-muted text-muted-foreground border-border'
                                }`}
                            >
                                {addImage ? 'Image: ON' : 'Image: OFF'}
                            </button>
                            <span className="text-xs text-muted-foreground">Generate AI image (DALL-E 3)</span>
                        </div>
                        {addImage && (
                            <Input
                                placeholder="Describe the image..."
                                value={imagePrompt}
                                onChange={e => setImagePrompt(e.target.value)}
                            />
                        )}
                    </div>

                    {/* Submit */}
                    <Button
                        className="w-full"
                        onClick={handlePost}
                        disabled={posting || !text.trim() || selectedPlatforms.length === 0}
                    >
                        {posting ? 'Posting...' : 'Post Now'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
