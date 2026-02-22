import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { blotato, buildTarget } from '@/lib/blotato';
import type { Platform } from '@/lib/blotato';
import { quickPostSchema } from '@/lib/schemas';
import { estimateClaudeCost, estimateDalleCost } from '@/lib/utils';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { personaId, text, platforms, expandWithAI, imagePrompt } = quickPostSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch persona for platform accounts and voice style
        const { data: persona, error: personaError } = await supabase
            .from('personas')
            .select('*')
            .eq('id', personaId)
            .single();

        if (personaError || !persona) {
            return NextResponse.json(
                { success: false, error: 'Persona not found' },
                { status: 404 },
            );
        }

        // Expand text with Claude if requested
        let caption = text;
        if (expandWithAI) {
            const response = await claude.generateContent(
                `You are ${persona.name}, a content creator with this voice style: ${persona.voice_style || 'professional and engaging'}.`,
                `Expand this idea into a social media post caption (max 2200 characters). Include relevant hashtags. Keep it authentic to the persona's voice.

Idea: ${text}

Respond with ONLY the caption text, no JSON or markdown.`,
                { maxTokens: 1024 },
            );

            caption = response.text || text;

            // Track Claude cost
            await supabase.from('cost_tracking').insert({
                service: 'claude',
                operation: 'quick_post_expand',
                cost_usd: estimateClaudeCost(response.inputTokens, response.outputTokens),
            });
        }

        // Generate image if requested
        let mediaUrls: string[] = [];
        if (imagePrompt) {
            try {
                const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    },
                    body: JSON.stringify({
                        model: 'dall-e-3',
                        prompt: imagePrompt,
                        n: 1,
                        size: '1024x1024',
                    }),
                });

                if (openaiRes.ok) {
                    const imageData = await openaiRes.json();
                    const imageUrl = imageData.data?.[0]?.url;
                    if (imageUrl) {
                        // Upload to Blotato for publishing
                        const uploaded = await blotato.uploadMedia(imageUrl);
                        mediaUrls = [uploaded.url];
                    }
                }

                await supabase.from('cost_tracking').insert({
                    service: 'openai',
                    operation: 'quick_post_image',
                    cost_usd: estimateDalleCost(1),
                });
            } catch (imgError) {
                console.error('Quick post image generation failed:', imgError);
                // Continue without image
            }
        }

        // Publish to each selected platform
        const platformAccounts = (persona.platform_accounts || {}) as Record<string, string>;
        const results: Record<string, { postId?: string; error?: string }> = {};

        for (const platform of platforms) {
            const accountId = platformAccounts[platform];
            if (!accountId) {
                results[platform] = { error: `No ${platform} account configured for ${persona.name}` };
                continue;
            }

            try {
                const target = buildTarget(platform as Platform, {
                    title: caption.slice(0, 100),
                    isAiGenerated: expandWithAI,
                });

                const response = await blotato.publishPost({
                    post: {
                        accountId,
                        content: {
                            text: caption,
                            mediaUrls,
                            platform: platform as Platform,
                        },
                        target,
                    },
                });

                results[platform] = { postId: response.postSubmissionId };
            } catch (pubError) {
                results[platform] = {
                    error: pubError instanceof Error ? pubError.message : 'Publish failed',
                };
            }
        }

        // Log to published_log for duplicate detection
        const crypto = await import('crypto');
        await supabase.from('published_log').insert({
            persona_id: personaId,
            topic_title: `Quick Post: ${text.slice(0, 80)}`,
            topic_hash: crypto.createHash('md5').update(text.toLowerCase().trim()).digest('hex'),
            published_at: new Date().toISOString(),
        });

        return NextResponse.json({
            success: true,
            caption,
            results,
            imageGenerated: mediaUrls.length > 0,
        });
    } catch (error) {
        console.error('Quick post error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
