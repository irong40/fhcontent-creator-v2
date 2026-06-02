import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { openai } from '@/lib/openai';
import { gemini } from '@/lib/gemini';
import { claude } from '@/lib/claude';
import { uploadImage } from '@/lib/storage';
import { estimateDalleCost, base64ToArrayBuffer } from '@/lib/utils';
import { thumbnailGenerateSchema } from '@/lib/schemas';
import { generateSlideWithLadder, type SlideLadderDeps } from '@/lib/carousel-slide';
import { renderHuvaSlide } from '@/lib/huva-template';

// Imagen/gpt-image-1 plus the satori (+ resvg native addon) template fallback
// require the Node.js serverless runtime, never edge.
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
        const { contentPieceId } = thumbnailGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch content piece
        const { data: piece, error: fetchError } = await supabase
            .from('content_pieces')
            .select('*')
            .eq('id', contentPieceId)
            .single();

        if (fetchError || !piece) {
            return NextResponse.json(
                { success: false, error: 'Content piece not found' },
                { status: 404 },
            );
        }

        if (!piece.thumbnail_prompt) {
            return NextResponse.json(
                { success: false, error: 'Content piece has no thumbnail prompt' },
                { status: 400 },
            );
        }

        // Idempotent: skip if already generated
        if (piece.thumbnail_url) {
            return NextResponse.json({
                success: true,
                skipped: true,
                thumbnailUrl: piece.thumbnail_url,
            });
        }

        // Resolve the persona subject constraint (audit gate) via the topic.
        let subjectConstraint: string | null = null;
        if (piece.topic_id) {
            const { data: topic } = await supabase
                .from('topics')
                .select('persona_id')
                .eq('id', piece.topic_id)
                .single();
            if (topic?.persona_id) {
                const { data: persona } = await supabase
                    .from('personas')
                    .select('image_subject_constraint')
                    .eq('id', topic.persona_id)
                    .single();
                subjectConstraint = persona?.image_subject_constraint ?? null;
            }
        }

        // Photoreal ladder: Imagen 4 primary → gpt-image-1 secondary → satori
        // template fallback. Every photographic rung is audited against the
        // subject constraint; the template (no people) bypasses it legitimately,
        // so a thumbnail can never hard-fail.
        const ladderDeps: SlideLadderDeps = {
            generatePrimary: async (prompt) => {
                const result = await gemini.generateImage(prompt, { aspectRatio: '1:1' });
                return base64ToArrayBuffer(result.imageData);
            },
            generateSecondary: async (prompt) => {
                const result = await openai.generateImage(prompt);
                return base64ToArrayBuffer(result.imageData);
            },
            audit: (image, constraint) => claude.auditImageSubjects(image, constraint),
            renderTemplate: (slide) => renderHuvaSlide(slide, 1),
            applyGuardrail: applySubjectGuardrail,
            log: (m) => console.log(m),
        };

        const result = await generateSlideWithLadder(
            { slide: 0, text: piece.thumbnail_prompt, imagePrompt: piece.thumbnail_prompt },
            subjectConstraint,
            ladderDeps,
        );

        const imageBuffer = result.imageBuffer;
        const sourceService = result.source === 'imagen' ? 'gemini' : result.source;

        // Upload to Supabase Storage
        const storagePath = `${piece.topic_id}/${piece.piece_type}_thumbnail.png`;
        const thumbnailUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

        // Update content piece
        await supabase
            .from('content_pieces')
            .update({ thumbnail_url: thumbnailUrl })
            .eq('id', contentPieceId);

        // Insert visual asset record
        await supabase.from('visual_assets').insert({
            content_piece_id: contentPieceId,
            asset_type: 'thumbnail',
            source_service: sourceService,
            asset_url: thumbnailUrl,
            metadata: {
                prompt: piece.thumbnail_prompt,
                attempts: result.attempts.map(a => ({
                    provider: a.provider,
                    attempt: a.attempt,
                    outcome: a.outcome,
                    ...(a.detail ? { detail: a.detail } : {}),
                })),
            },
            status: 'ready',
        });

        // Track cost (only when gpt-image-1 produced the image)
        const costUsd = result.source === 'openai' ? estimateDalleCost(1) : 0;
        if (costUsd > 0) {
            await supabase.from('cost_tracking').insert({
                service: 'openai',
                operation: 'gpt_image_thumbnail',
                topic_id: piece.topic_id,
                content_piece_id: contentPieceId,
                cost_usd: costUsd,
            });
        }

        return NextResponse.json({
            success: true,
            thumbnailUrl,
            sourceService,
            source: result.source,
            costUsd,
        });
    } catch (error) {
        console.error('Thumbnail generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
