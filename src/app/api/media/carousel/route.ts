import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { openai } from '@/lib/openai';
import { uploadImage } from '@/lib/storage';
import { estimateClaudeCost, estimateDalleCost, base64ToArrayBuffer } from '@/lib/utils';
import { carouselGenerateSchema, carouselSlidesResponseSchema } from '@/lib/schemas';
import { buildCarouselSlidesPrompt } from '@/lib/prompts';
import { generateSlideWithLadder, serializeAttempts, type SlideLadderDeps } from '@/lib/carousel-slide';
import { buildArchivalQueries, findArchivalImages, ARCHIVAL_AUDIT_RULES } from '@/lib/archival';
import { renderHuvaSlide } from '@/lib/huva-template';
import type { CarouselSlide, HistoricalPoint, Topic } from '@/types/database';

// satori + resvg-js (native addon) require the Node.js serverless runtime.
export const runtime = 'nodejs';

/**
 * Belt-and-suspenders subject guardrail prepended to every photoreal prompt when
 * the persona has an image_subject_constraint. Mirrors daily-media's directive.
 */
function applySubjectGuardrail(prompt: string, constraint: string | null | undefined): string {
    if (!constraint) return prompt;
    const directive =
        'HARD CONSTRAINT — read before rendering: ' + constraint + ' ' +
        'Render ZERO background figures, ZERO crowds, ZERO incidental people. ' +
        'If the prompt below describes people, render a TIGHT CLOSE-UP of ONE individual only, with dark brown skin clearly and unambiguously visible — never silhouette, never wide shot. ' +
        'If the prompt below mentions maps, "scenes", "community", or groups, omit all human figures entirely and render only objects, documents, architecture, or landscape. ' +
        'Prompt follows:\n\n';
    return directive + prompt;
}

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
            .select('voice_style, brand, platform_accounts, image_subject_constraint')
            .eq('id', topic.persona_id)
            .single();

        const brandTone = persona?.voice_style || 'authoritative yet conversational';
        const imageSubjectConstraint = persona?.image_subject_constraint ?? null;
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
            imageSubjectConstraint,
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

        // Step 2: Produce each slide PHOTO-FIRST — a rights-cleared Library of
        // Congress photograph where one exists, gpt-image-1 where it doesn't, and
        // the typographic card only as a last resort. Mirrors the daily-media
        // cron, which is the path that runs in production.
        const carouselSlides: CarouselSlide[] = [];
        const imageUrls: string[] = [];
        let imagesGenerated = 0;
        const slideTotal = generatedSlides.length;

        const slideEntries: CarouselSlide[] = generatedSlides.map(slide => ({
            slide: slide.slide_number,
            text: slide.body,
            imagePrompt: slide.image_prompt,
        }));

        // One archival search per carousel, dealt out across the slides.
        const archivalPool = imageSubjectConstraint
            ? await findArchivalImages(
                buildArchivalQueries(topic.title, slideEntries.map(s => s.text).join(' ')),
                slideTotal,
                { log: (m) => console.log(m) },
            )
            : [];

        const ladderDeps: SlideLadderDeps = {
            generateArchival: async () => {
                const next = archivalPool.shift();
                return next
                    ? { bytes: next.bytes, credit: next.credit, title: next.title, sourceUrl: next.sourceUrl }
                    : null;
            },
            generatePhoto: async (prompt) => {
                const result = await openai.generateImage(prompt);
                return base64ToArrayBuffer(result.imageData);
            },
            audit: (image, constraint) => claude.auditImageSubjects(image, constraint),
            renderTemplate: (s) => renderHuvaSlide(s, slideTotal),
            applyGuardrail: applySubjectGuardrail,
            archivalAuditRules: ARCHIVAL_AUDIT_RULES,
            log: (m) => console.log(m),
        };

        for (const slideEntry of slideEntries) {
            const source = generatedSlides.find(s => s.slide_number === slideEntry.slide);

            try {
                const result = await generateSlideWithLadder(
                    slideEntry,
                    imageSubjectConstraint,
                    ladderDeps,
                );

                // A photograph is composited behind the slide typography with its
                // credit; the template rung already returns a finished card.
                const imageBuffer = result.source === 'template'
                    ? result.imageBuffer
                    : await renderHuvaSlide(slideEntry, slideTotal, {
                        photo: { bytes: result.imageBuffer, credit: result.credit ?? '' },
                    });

                const storagePath = `${topic.id}/carousel_slide_${slideEntry.slide}.png`;
                const slideImageUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

                imageUrls.push(slideImageUrl);
                imagesGenerated++;

                // Track visual asset
                await supabase.from('visual_assets').insert({
                    content_piece_id: contentPieceId,
                    asset_type: 'carousel_image',
                    source_service: result.source,
                    asset_url: slideImageUrl,
                    metadata: {
                        slide: slideEntry.slide,
                        title: source?.title,
                        prompt: slideEntry.imagePrompt,
                        ...(result.credit ? { credit: result.credit } : {}),
                        ...(result.sourceUrl ? { archival_source: result.sourceUrl } : {}),
                        attempts: serializeAttempts(result.attempts),
                    },
                    status: 'ready',
                });

                if (result.source === 'openai') {
                    await supabase.from('cost_tracking').insert({
                        service: 'openai',
                        operation: 'gpt_image_carousel_slide',
                        topic_id: topic.id,
                        content_piece_id: contentPieceId,
                        cost_usd: estimateDalleCost(1),
                    });
                }
            } catch (e) {
                console.warn(`Failed to render image for slide ${slideEntry.slide}:`, e);
            }

            carouselSlides.push(slideEntry);
        }

        // Step 3: Store carousel slides and all image URLs in content_piece
        // carousel_url stores a JSON array of all slide image URLs so the
        // daily-publish cron can pass them all to Blotato (not just the first).
        await supabase
            .from('content_pieces')
            .update({
                carousel_slides: carouselSlides as unknown as CarouselSlide[],
                carousel_url: imageUrls.length > 0 ? JSON.stringify(imageUrls) : null,
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
