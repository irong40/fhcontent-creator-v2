'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import type { Persona, PlatformAccounts } from '@/types/database';

const PLATFORMS: Array<keyof PlatformAccounts> = [
    'tiktok',
    'instagram',
    'youtube',
    'threads',
    'twitter',
    'bluesky',
    'linkedin',
    'facebook',
    'fanbase',
];

function linesToArray(raw: string): string[] {
    return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

export default function EditPersonaPage() {
    const router = useRouter();
    const params = useParams();
    const supabase = createClient();
    const [persona, setPersona] = useState<Persona | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            const { data, error } = await supabase
                .from('personas')
                .select('*')
                .eq('id', params.id as string)
                .single();
            if (error) setError(error.message);
            else setPersona(data as Persona);
            setLoading(false);
        }
        load();
    }, [params.id, supabase]);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setSaving(true);
        setError(null);

        const formData = new FormData(e.currentTarget);

        const platformAccounts: PlatformAccounts = {};
        for (const platform of PLATFORMS) {
            const val = (formData.get(`platform_${platform}`) as string)?.trim();
            if (val) platformAccounts[platform] = val;
        }

        const update: Record<string, unknown> = {
            name: formData.get('name') as string,
            brand: formData.get('brand') as string,
            tagline: (formData.get('tagline') as string) || null,
            expertise_areas: linesToArray(formData.get('expertise_areas') as string),
            voice_style: formData.get('voice_style') as string,
            content_guidelines: (formData.get('content_guidelines') as string) || null,
            content_guardrail: (formData.get('content_guardrail') as string) || null,
            image_subject_constraint: (formData.get('image_subject_constraint') as string) || null,
            platform_accounts: platformAccounts,
            voice_pool: linesToArray(formData.get('voice_pool') as string),
            profile_image_url: (formData.get('profile_image_url') as string) || null,
            heygen_avatar_id: (formData.get('heygen_avatar_id') as string) || null,
            heygen_voice_id: (formData.get('heygen_voice_id') as string) || null,
            blotato_template_id: (formData.get('blotato_template_id') as string) || null,
            default_music_url: (formData.get('default_music_url') as string) || null,
            newsletter_url: (formData.get('newsletter_url') as string) || null,
            newsletter_cta: (formData.get('newsletter_cta') as string) || null,
            guardrail_notebook_ids: linesToArray(formData.get('guardrail_notebook_ids') as string),
            facebook_page_ids: linesToArray(formData.get('facebook_page_ids') as string),
            is_active: formData.get('is_active') === 'on',
            updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
            .from('personas')
            .update(update)
            .eq('id', params.id as string);

        if (updateError) {
            setError(updateError.message);
            setSaving(false);
            return;
        }

        router.push('/personas');
        router.refresh();
    }

    async function handleDelete() {
        if (!confirm('Delete this persona? All associated topics, content pieces, and cost records will also be removed. This cannot be undone.')) return;
        setSaving(true);

        const { error: deleteError } = await supabase
            .from('personas')
            .delete()
            .eq('id', params.id as string);

        if (deleteError) {
            setError(deleteError.message);
            setSaving(false);
            return;
        }

        router.push('/personas');
        router.refresh();
    }

    if (loading) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
        </div>
    );
    if (!persona) return <div className="container py-8">Persona not found</div>;

    const accounts = (persona.platform_accounts ?? {}) as Record<string, string>;

    return (
        <div className="container max-w-screen-md py-8">
            <h1 className="text-3xl font-bold mb-8">Edit Persona</h1>
            <form onSubmit={handleSubmit}>
                <Card>
                    <CardHeader>
                        <CardTitle>Basic Info</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name *</Label>
                                <Input id="name" name="name" defaultValue={persona.name} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="brand">Brand *</Label>
                                <Input id="brand" name="brand" defaultValue={persona.brand} required />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tagline">Tagline</Label>
                            <Input id="tagline" name="tagline" defaultValue={persona.tagline ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="profile_image_url">Profile Image URL</Label>
                            <Input id="profile_image_url" name="profile_image_url" defaultValue={persona.profile_image_url ?? ''} />
                        </div>
                        <div className="flex items-center gap-2">
                            <input type="checkbox" id="is_active" name="is_active" defaultChecked={persona.is_active} />
                            <Label htmlFor="is_active">Active</Label>
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle>AI Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="expertise_areas">Expertise Areas * (one per line)</Label>
                            <Textarea id="expertise_areas" name="expertise_areas" rows={4} defaultValue={persona.expertise_areas.join('\n')} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="voice_style">Voice Style *</Label>
                            <Textarea id="voice_style" name="voice_style" rows={3} defaultValue={persona.voice_style} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="content_guidelines">Content Guidelines</Label>
                            <Textarea id="content_guidelines" name="content_guidelines" rows={3} defaultValue={persona.content_guidelines ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="content_guardrail">Content Guardrail</Label>
                            <p className="text-xs text-muted-foreground">
                                Hard editorial rule injected into Claude prompts. Topic / script must comply or generation is rejected.
                            </p>
                            <Textarea id="content_guardrail" name="content_guardrail" rows={3} defaultValue={persona.content_guardrail ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="image_subject_constraint">Image Subject Constraint</Label>
                            <p className="text-xs text-muted-foreground">
                                Rule injected into image-generation prompts AND used by the Claude vision audit. Example: &ldquo;All people depicted must be Black/African American.&rdquo; Leave blank for no constraint.
                            </p>
                            <Textarea id="image_subject_constraint" name="image_subject_constraint" rows={3} defaultValue={persona.image_subject_constraint ?? ''} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle>Platform Accounts (Blotato IDs)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {PLATFORMS.map((platform) => (
                            <div key={platform} className="space-y-2">
                                <Label htmlFor={`platform_${platform}`}>{platform.charAt(0).toUpperCase() + platform.slice(1)}</Label>
                                <Input id={`platform_${platform}`} name={`platform_${platform}`} defaultValue={accounts[platform] ?? ''} />
                            </div>
                        ))}
                        <Separator />
                        <div className="space-y-2">
                            <Label htmlFor="facebook_page_ids">Facebook Page IDs (one per line, for multi-page publishing)</Label>
                            <Textarea
                                id="facebook_page_ids"
                                name="facebook_page_ids"
                                rows={3}
                                defaultValue={(persona.facebook_page_ids ?? []).join('\n')}
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle>Voice & Media</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="voice_pool">Voice Pool (ElevenLabs IDs, one per line) *</Label>
                            <Textarea id="voice_pool" name="voice_pool" rows={4} defaultValue={persona.voice_pool.join('\n')} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="default_music_url">Default Music URL</Label>
                            <p className="text-xs text-muted-foreground">
                                Pre-uploaded fallback music track. Used by daily-media when Lyria music generation fails. Leave blank to skip music gracefully on failure.
                            </p>
                            <Input id="default_music_url" name="default_music_url" defaultValue={persona.default_music_url ?? ''} placeholder="https://..." />
                        </div>
                        <Separator />
                        <div className="space-y-2">
                            <Label htmlFor="heygen_avatar_id">HeyGen Avatar ID</Label>
                            <Input id="heygen_avatar_id" name="heygen_avatar_id" defaultValue={persona.heygen_avatar_id ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="heygen_voice_id">HeyGen Voice ID</Label>
                            <Input id="heygen_voice_id" name="heygen_voice_id" defaultValue={persona.heygen_voice_id ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="blotato_template_id">Blotato Template ID (for AI Story Video / faceless shorts)</Label>
                            <Input id="blotato_template_id" name="blotato_template_id" defaultValue={persona.blotato_template_id ?? ''} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle>Newsletter</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="newsletter_url">Newsletter URL</Label>
                            <Input id="newsletter_url" name="newsletter_url" defaultValue={persona.newsletter_url ?? ''} placeholder="https://...substack.com" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="newsletter_cta">Newsletter CTA</Label>
                            <p className="text-xs text-muted-foreground">
                                Call-to-action text appended to long-form video outros and captions.
                            </p>
                            <Input id="newsletter_cta" name="newsletter_cta" defaultValue={persona.newsletter_cta ?? ''} />
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle>Advanced</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="guardrail_notebook_ids">Guardrail Notebook IDs (NotebookLM, one per line)</Label>
                            <p className="text-xs text-muted-foreground">
                                IDs of NotebookLM notebooks consulted by the content guardrail before scripts are written.
                            </p>
                            <Textarea
                                id="guardrail_notebook_ids"
                                name="guardrail_notebook_ids"
                                rows={3}
                                defaultValue={(persona.guardrail_notebook_ids ?? []).join('\n')}
                            />
                        </div>
                    </CardContent>
                </Card>

                {error && (
                    <p className="text-destructive mt-4">{error}</p>
                )}

                <div className="flex gap-4 mt-6">
                    <Button type="submit" disabled={saving}>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => router.back()}>
                        Cancel
                    </Button>
                    <Button type="button" variant="destructive" onClick={handleDelete} disabled={saving} className="ml-auto">
                        Delete Persona
                    </Button>
                </div>
            </form>
        </div>
    );
}
