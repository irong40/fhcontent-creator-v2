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
            else setPersona(data);
            setLoading(false);
        }
        load();
    }, [params.id, supabase]);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setSaving(true);
        setError(null);

        const formData = new FormData(e.currentTarget);

        const expertiseRaw = formData.get('expertise_areas') as string;
        const voicePoolRaw = formData.get('voice_pool') as string;

        const platformAccounts: PlatformAccounts = {};
        for (const platform of ['tiktok', 'instagram', 'youtube', 'threads', 'twitter'] as const) {
            const val = (formData.get(`platform_${platform}`) as string)?.trim();
            if (val) platformAccounts[platform] = val;
        }

        const { error: updateError } = await supabase
            .from('personas')
            .update({
                name: formData.get('name') as string,
                brand: formData.get('brand') as string,
                tagline: (formData.get('tagline') as string) || null,
                expertise_areas: expertiseRaw.split('\n').map(s => s.trim()).filter(Boolean),
                voice_style: formData.get('voice_style') as string,
                content_guidelines: (formData.get('content_guidelines') as string) || null,
                platform_accounts: platformAccounts,
                voice_pool: voicePoolRaw.split('\n').map(s => s.trim()).filter(Boolean),
                profile_image_url: (formData.get('profile_image_url') as string) || null,
                heygen_avatar_id: (formData.get('heygen_avatar_id') as string) || null,
                canva_brand_kit_id: (formData.get('canva_brand_kit_id') as string) || null,
                canva_carousel_template_id: (formData.get('canva_carousel_template_id') as string) || null,
                is_active: formData.get('is_active') === 'on',
                updated_at: new Date().toISOString(),
            })
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
        if (!confirm('Delete this persona? This cannot be undone.')) return;
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

    if (loading) return <div className="container py-8">Loading...</div>;
    if (!persona) return <div className="container py-8">Persona not found</div>;

    const accounts = persona.platform_accounts as Record<string, string>;

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
                    </CardContent>
                </Card>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle>Platform Accounts (Blotato IDs)</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {['tiktok', 'instagram', 'youtube', 'threads', 'twitter'].map((platform) => (
                            <div key={platform} className="space-y-2">
                                <Label htmlFor={`platform_${platform}`}>{platform.charAt(0).toUpperCase() + platform.slice(1)}</Label>
                                <Input id={`platform_${platform}`} name={`platform_${platform}`} defaultValue={accounts[platform] ?? ''} />
                            </div>
                        ))}
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
                        <Separator />
                        <div className="space-y-2">
                            <Label htmlFor="heygen_avatar_id">HeyGen Avatar ID</Label>
                            <Input id="heygen_avatar_id" name="heygen_avatar_id" defaultValue={persona.heygen_avatar_id ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="canva_brand_kit_id">Canva Brand Kit ID</Label>
                            <Input id="canva_brand_kit_id" name="canva_brand_kit_id" defaultValue={persona.canva_brand_kit_id ?? ''} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="canva_carousel_template_id">Canva Carousel Template ID</Label>
                            <Input id="canva_carousel_template_id" name="canva_carousel_template_id" defaultValue={persona.canva_carousel_template_id ?? ''} />
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
