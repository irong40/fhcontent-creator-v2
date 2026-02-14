'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import type { PlatformAccounts } from '@/types/database';

export default function NewPersonaPage() {
    const router = useRouter();
    const supabase = createClient();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const formData = new FormData(e.currentTarget);

        const expertiseRaw = formData.get('expertise_areas') as string;
        const voicePoolRaw = formData.get('voice_pool') as string;

        const platformAccounts: PlatformAccounts = {};
        for (const platform of ['tiktok', 'instagram', 'youtube', 'threads', 'twitter'] as const) {
            const val = (formData.get(`platform_${platform}`) as string)?.trim();
            if (val) platformAccounts[platform] = val;
        }

        const { error: insertError } = await supabase.from('personas').insert({
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
        });

        if (insertError) {
            setError(insertError.message);
            setLoading(false);
            return;
        }

        router.push('/personas');
        router.refresh();
    }

    return (
        <div className="container max-w-screen-md py-8">
            <h1 className="text-3xl font-bold mb-8">New Persona</h1>
            <form onSubmit={handleSubmit}>
                <Card>
                    <CardHeader>
                        <CardTitle>Basic Info</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name *</Label>
                                <Input id="name" name="name" placeholder="Dr. Imani Carter" required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="brand">Brand *</Label>
                                <Input id="brand" name="brand" placeholder="History Unveiled VA" required />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tagline">Tagline</Label>
                            <Input id="tagline" name="tagline" placeholder="Uncovering untold stories..." />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="profile_image_url">Profile Image URL</Label>
                            <Input id="profile_image_url" name="profile_image_url" placeholder="https://..." />
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
                            <Textarea id="expertise_areas" name="expertise_areas" rows={4} placeholder={"Civil Rights Movement\nAfrican American History\nVirginia History"} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="voice_style">Voice Style *</Label>
                            <Textarea id="voice_style" name="voice_style" rows={3} placeholder="Authoritative yet accessible. PhD historian who makes complex history engaging..." required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="content_guidelines">Content Guidelines</Label>
                            <Textarea id="content_guidelines" name="content_guidelines" rows={3} placeholder="Do's and don'ts for content generation..." />
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
                                <Input id={`platform_${platform}`} name={`platform_${platform}`} placeholder="Account ID" />
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
                            <Textarea id="voice_pool" name="voice_pool" rows={4} placeholder="Xb7hH8MSUJpSbSDYk0k2&#10;9BWtsMINqrJLrRacOk9x" required />
                        </div>
                        <Separator />
                        <div className="space-y-2">
                            <Label htmlFor="heygen_avatar_id">HeyGen Avatar ID</Label>
                            <Input id="heygen_avatar_id" name="heygen_avatar_id" placeholder="avatar_..." />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="canva_brand_kit_id">Canva Brand Kit ID</Label>
                            <Input id="canva_brand_kit_id" name="canva_brand_kit_id" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="canva_carousel_template_id">Canva Carousel Template ID</Label>
                            <Input id="canva_carousel_template_id" name="canva_carousel_template_id" />
                        </div>
                    </CardContent>
                </Card>

                {error && (
                    <p className="text-destructive mt-4">{error}</p>
                )}

                <div className="flex gap-4 mt-6">
                    <Button type="submit" disabled={loading}>
                        {loading ? 'Creating...' : 'Create Persona'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => router.back()}>
                        Cancel
                    </Button>
                </div>
            </form>
        </div>
    );
}
