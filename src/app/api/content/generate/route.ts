import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { contentGenerateSchema, contentResponseSchema } from '@/lib/schemas';
import { buildContentPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import type { PieceType, TopicWithPersona } from '@/types/database';

const PIECE_ORDER: Record<PieceType, number> = {
    long: 1,
    short_1: 2,
    short_2: 3,
    short_3: 4,
    short_4: 5,
    carousel: 6,
};

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { topicId } = contentGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch topic with persona
        const { data, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('id', topicId)
            .single();

        if (topicError || !data) {
            return NextResponse.json({ success: false, error: 'Topic not found' }, { status: 404 });
        }

        const topic = data as unknown as TopicWithPersona;
        const persona = topic.personas;

        // Update topic status to generating
        await supabase
            .from('topics')
            .update({ status: 'content_generating' })
            .eq('id', topicId);

        // Build prompt and call Claude
        const { system, user } = buildContentPrompt(persona, topic);
        const { text, inputTokens, outputTokens } = await claude.generateContent(system, user, {
            maxTokens: 8192,
        });

        // Parse and validate response
        const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
        let rawParsed: unknown;
        try {
            rawParsed = JSON.parse(jsonText);
        } catch {
            await supabase.from('topics').update({ status: 'draft' }).eq('id', topicId);
            return NextResponse.json(
                { success: false, error: 'AI returned invalid JSON' },
                { status: 502 },
            );
        }
        const parsed = contentResponseSchema.safeParse(rawParsed);

        if (!parsed.success) {
            // Revert topic status on parse failure
            await supabase.from('topics').update({ status: 'draft' }).eq('id', topicId);
            return NextResponse.json(
                { success: false, error: 'Invalid AI response format', details: parsed.error.issues },
                { status: 502 },
            );
        }

        // Insert 6 content pieces
        const insertedPieces = [];
        for (const piece of parsed.data.pieces) {
            const { data: inserted, error: insertError } = await supabase
                .from('content_pieces')
                .insert({
                    topic_id: topicId,
                    piece_type: piece.pieceType,
                    piece_order: PIECE_ORDER[piece.pieceType],
                    script: piece.script,
                    caption_long: piece.captionLong,
                    caption_short: piece.captionShort,
                    thumbnail_prompt: piece.thumbnailPrompt || null,
                    carousel_slides: piece.carouselSlides as unknown as null,
                    music_track: piece.musicTrack || null,
                    status: 'ready',
                })
                .select()
                .single();

            if (insertError) {
                console.error('Error inserting piece:', insertError);
                continue;
            }

            insertedPieces.push({
                id: inserted.id,
                pieceType: piece.pieceType,
                scriptLength: piece.script.length,
            });
        }

        // Update topic status to content_ready
        await supabase
            .from('topics')
            .update({
                status: 'content_ready',
                content_ready_at: new Date().toISOString(),
            })
            .eq('id', topicId);

        // Track cost
        const costUsd = estimateClaudeCost(inputTokens, outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'content_generation',
            topic_id: topicId,
            cost_usd: costUsd,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
        });

        return NextResponse.json({
            success: true,
            pieces: insertedPieces,
            usage: { inputTokens, outputTokens, costUsd },
        });
    } catch (error) {
        console.error('Content generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
