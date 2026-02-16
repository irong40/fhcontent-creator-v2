import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { buildRemixPrompt } from '@/lib/prompts';
import type { RemixField } from '@/lib/prompts';
import {
    remixRequestSchema,
    remixScriptResponseSchema,
    remixCaptionLongResponseSchema,
    remixCaptionShortResponseSchema,
    remixThumbnailPromptResponseSchema,
    remixCarouselSlidesResponseSchema,
} from '@/lib/schemas';
import { estimateClaudeCost } from '@/lib/utils';
import type { TopicWithPersona, PieceType } from '@/types/database';
import type { z } from 'zod';

const RESPONSE_SCHEMAS: Record<RemixField, z.ZodType> = {
    script: remixScriptResponseSchema,
    caption_long: remixCaptionLongResponseSchema,
    caption_short: remixCaptionShortResponseSchema,
    thumbnail_prompt: remixThumbnailPromptResponseSchema,
    carousel_slides: remixCarouselSlidesResponseSchema,
};

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const body = await request.json();

        const fieldParsed = remixRequestSchema.safeParse(body);
        if (!fieldParsed.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid field', details: fieldParsed.error.issues },
                { status: 400 },
            );
        }
        const { field } = fieldParsed.data;

        const supabase = createAdminClient();

        // Fetch content piece
        const { data: piece, error: pieceError } = await supabase
            .from('content_pieces')
            .select('*')
            .eq('id', id)
            .single();

        if (pieceError || !piece) {
            return NextResponse.json(
                { success: false, error: 'Content piece not found' },
                { status: 404 },
            );
        }

        // Fetch topic with persona
        const { data: topicData, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('id', piece.topic_id)
            .single();

        if (topicError || !topicData) {
            return NextResponse.json(
                { success: false, error: 'Topic not found' },
                { status: 404 },
            );
        }

        const topic = topicData as unknown as TopicWithPersona;
        const persona = topic.personas;
        const pieceType = piece.piece_type as PieceType;

        // Get current value of the field
        let currentValue: string;
        if (field === 'carousel_slides') {
            currentValue = JSON.stringify(piece.carousel_slides || []);
        } else {
            currentValue = (piece[field] as string) || '';
        }

        // Build focused prompt
        const { system, user, maxTokens } = buildRemixPrompt(persona, topic, pieceType, field, currentValue);

        const { text, inputTokens, outputTokens } = await claude.generateContent(system, user, { maxTokens });

        const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
        let rawParsed: unknown;
        try {
            rawParsed = JSON.parse(jsonText);
        } catch {
            return NextResponse.json(
                { success: false, error: 'AI returned invalid JSON' },
                { status: 502 },
            );
        }

        // Validate with field-specific schema
        const schema = RESPONSE_SCHEMAS[field];
        const validated = schema.safeParse(rawParsed);
        if (!validated.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid AI response format', details: validated.error.issues },
                { status: 502 },
            );
        }
        const parsed = validated.data as Record<string, unknown>;

        // Build update — only the remixed field
        const updateData: Record<string, unknown> = {};

        switch (field) {
            case 'script':
                updateData.script = parsed.script;
                // Script change invalidates audio + video
                updateData.heygen_job_id = null;
                updateData.heygen_status = null;
                updateData.video_url = null;
                break;
            case 'caption_long':
                updateData.caption_long = parsed.captionLong;
                break;
            case 'caption_short':
                updateData.caption_short = parsed.captionShort;
                break;
            case 'thumbnail_prompt':
                updateData.thumbnail_prompt = parsed.thumbnailPrompt;
                updateData.thumbnail_url = null;
                break;
            case 'carousel_slides':
                updateData.carousel_slides = parsed.carouselSlides;
                updateData.canva_design_id = null;
                updateData.carousel_url = null;
                break;
        }

        const { error: updateError } = await supabase
            .from('content_pieces')
            .update(updateData)
            .eq('id', id);

        if (updateError) {
            return NextResponse.json(
                { success: false, error: updateError.message },
                { status: 500 },
            );
        }

        // Conditionally clear stale assets
        if (field === 'script') {
            await supabase.from('audio_assets').delete().eq('content_piece_id', id);
        }
        if (field === 'thumbnail_prompt') {
            await supabase.from('visual_assets').delete().eq('content_piece_id', id).eq('asset_type', 'thumbnail');
        }
        if (field === 'carousel_slides') {
            await supabase.from('visual_assets').delete().eq('content_piece_id', id).eq('asset_type', 'carousel_image');
        }

        // Track cost
        const costUsd = estimateClaudeCost(inputTokens, outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: `remix_${field}`,
            topic_id: piece.topic_id,
            content_piece_id: id,
            cost_usd: costUsd,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
        });

        return NextResponse.json({
            success: true,
            field,
            pieceType,
            usage: { inputTokens, outputTokens, costUsd },
        });
    } catch (error) {
        console.error('Remix error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
