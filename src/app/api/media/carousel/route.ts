import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { gemini } from '@/lib/gemini';
import { uploadImage } from '@/lib/storage';
import { estimateClaudeCost, base64ToArrayBuffer } from '@/lib/utils';
import { carouselGenerateSchema, carouselSlidesResponseSchema } from '@/lib/schemas';
import { buildCarouselSlidesPrompt } from '@/lib/prompts';
import type { CarouselSlide, HistoricalPoint, Topic } from '@/types/database';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId } = carouselGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch content piece with its topic
        const { data: piece, error: fetchError } = await supabase
            .from('content_pieces')
            .select('*, topics(*)')
            .eq('id', contentPieceId)
            .single();

        if (fetchError || !piece) {
            return NextResponse.json(
                { success: false, error: 'Content piece not found' },
                { status: 404 },
            );
        }

        if (piece.piece_type !== 'carousel') {
            return NextResponse.json(
                { success: false, error: 'Content piece is not a carousel type' },
                { status: 400 },
            );
        }

        // Idempotent: skip if carousel slides already generated and images exist
        const existingSlides = piece.carousel_slides as CarouselSlide[] | null;
        if (existingSlides && existingSlides.length > 0 && piece.status === 'produced') {
            return NextResponse.json({
                success: true,
                skipped: true,
                slideCount: existingSlides.length,
                carouselUrl: piece.carousel_url,
            });
        }

        const topic = piece.topics as unknown as Topic;

        if (!topic) {
            return NextResponse.json(
                { success: false, error: 'Topic not found for content piece' },
                { status: 404 },
            );
        }

        // Fetch persona for brand tone
        const { data: persona } = await supabase
            .from('personas')
            .select('voice_style, brand, platform_accounts')
            .eq('id', topic.persona_id)
            .single();

        const brandTone = persona?.voice_style || 'authoritative yet conversational';
        const historicalPoints = topic.historical_points as HistoricalPoint[];

        // Mark piece as generating
        await supabase
            .from('content_pieces')
            .update({ status: 'generating' })
            .eq('id', contentPieceId);

        // Step 1: Generate carousel slides via Claude
        const { system, user } = buildCarouselSlidesPrompt(
            topic,
            historicalPoints,
            brandTone,
        );

        const claudeResult = await claude.generateContent(system, user, {
            maxTokens: 4096,
        });

        // Parse and validate the Claude response
        let parsed: unknown;
        try {
            parsed = JSON.parse(claudeResult.text);
        } catch {
            return NextResponse.json(
                { success: false, error: 'AI returned invalid JSON' },
                { status: 502 },
            );
        }
        const { slides: generatedSlides } = carouselSlidesResponseSchema.parse(parsed);

        // Track Claude cost
        const claudeCost = estimateClaudeCost(claudeResult.inputTokens, claudeResult.outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'carousel_slides_generation',
            topic_id: topic.id,
            content_piece_id: contentPieceId,
            cost_usd: claudeCost,
            tokens_input: claudeResult.inputTokens,
            tokens_output: claudeResult.outputTokens,
        });

        // Step 2: Generate images for each slide via Gemini
        const carouselSlides: CarouselSlide[] = [];
        const imageUrls: string[] = [];
        let imagesGenerated = 0;

        for (const slide of generatedSlides) {
            const slideEntry: CarouselSlide = {
                slide: slide.slide_number,
                text: slide.body,
                imagePrompt: slide.image_prompt,
            };

            try {
                const imageResult = await gemini.generateImage(slide.image_prompt, {
                    aspectRatio: '1:1',
                });

                if (imageResult?.imageData) {
                    // Upload base64 image to Supabase Storage
                    const imageBuffer = base64ToArrayBuffer(imageResult.imageData);
                    const storagePath = `${topic.id}/carousel_slide_${slide.slide_number}.png`;
                    const slideImageUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

                    imageUrls.push(slideImageUrl);
                    imagesGenerated++;

                    // Track visual asset
                    await supabase.from('visual_assets').insert({
                        content_piece_id: contentPieceId,
                        asset_type: 'carousel_image',
                        source_service: 'gemini',
                        asset_url: slideImageUrl,
                        metadata: {
                            slide: slide.slide_number,
                            title: slide.title,
                            prompt: slide.image_prompt,
                        },
                        status: 'ready',
                    });
                }
            } catch (e) {
                console.warn(`Failed to generate image for slide ${slide.slide_number}:`, e);
            }

            carouselSlides.push(slideEntry);
        }

        // Step 3: Store carousel slides in content_piece
        await supabase
            .from('content_pieces')
            .update({
                carousel_slides: carouselSlides as unknown as CarouselSlide[],
                status: 'produced',
                produced_at: new Date().toISOString(),
            })
            .eq('id', contentPieceId);

        // Publishing is handled by the daily-publish cron job to avoid double-posting.
        // This route only generates carousel content (slides + images).

        return NextResponse.json({
            success: true,
            slideCount: carouselSlides.length,
            imagesGenerated,
            claudeCost,
        });
    } catch (error) {
        console.error('Carousel generation error:', error);

        // Try to update status to failed
        try {
            const body = await request.clone().json();
            if (body.contentPieceId) {
                const supabase = createAdminClient();
                await supabase
                    .from('content_pieces')
                    .update({
                        status: 'failed',
                        error_message: error instanceof Error ? error.message : 'Unknown error',
                    })
                    .eq('id', body.contentPieceId);
            }
        } catch { /* ignore cleanup errors */ }

        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
