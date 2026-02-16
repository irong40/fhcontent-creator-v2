import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { buildContentPrompt } from '@/lib/prompts';
import { regeneratePieceResponseSchema } from '@/lib/schemas';
import { estimateClaudeCost } from '@/lib/utils';
import type { TopicWithPersona, PieceType } from '@/types/database';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
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

        // Build a focused prompt for regenerating just this one piece
        const { system } = buildContentPrompt(persona, topic);

        const pieceLabels: Record<PieceType, string> = {
            long: 'LONG VIDEO (2-4 minutes, 500-800 words, covers all 4 points)',
            short_1: 'SHORT VIDEO 1 (30 seconds, 60-100 words, deep dive on Point 1)',
            short_2: 'SHORT VIDEO 2 (30 seconds, 60-100 words, deep dive on Point 2)',
            short_3: 'SHORT VIDEO 3 (30 seconds, 60-100 words, deep dive on Point 3)',
            short_4: 'SHORT VIDEO 4 (30 seconds, 60-100 words, deep dive on Point 4)',
            carousel: 'CAROUSEL (8-10 slides with imagePrompt per slide)',
        };

        const isCarousel = pieceType === 'carousel';

        const userPrompt = `Regenerate ONLY the ${pieceLabels[pieceType]} for this topic:

TOPIC: ${topic.title}
HOOK: ${topic.hook}

HISTORICAL POINTS:
${(topic.historical_points as Array<{ point: number; claim: string; source: string; year: string }>).map(p => `${p.point}. ${p.claim} (Source: ${p.source}, ${p.year})`).join('\n')}

Provide a fresh, improved version. Output JSON:
{
  "script": "...",
  "captionLong": "...",
  "captionShort": "...",
  "thumbnailPrompt": "..."${isCarousel ? `,
  "carouselSlides": [{"slide": 1, "text": "...", "imagePrompt": "..."}, ...],
  "musicTrack": "inspirational"` : ''}
}`;

        const { text, inputTokens, outputTokens } = await claude.generateContent(system, userPrompt, {
            maxTokens: 4096,
        });

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

        const validated = regeneratePieceResponseSchema.safeParse(rawParsed);
        if (!validated.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid AI response format', details: validated.error.issues },
                { status: 502 },
            );
        }
        const parsed = validated.data;

        // Update the piece with new content
        const updateData: Record<string, unknown> = {
            script: parsed.script,
            caption_long: parsed.captionLong,
            caption_short: parsed.captionShort,
            thumbnail_prompt: parsed.thumbnailPrompt || null,
            // Clear stale media
            thumbnail_url: null,
            heygen_job_id: null,
            heygen_status: null,
            video_url: null,
            status: 'ready',
        };

        if (isCarousel && parsed.carouselSlides) {
            updateData.carousel_slides = parsed.carouselSlides;
            updateData.canva_design_id = null;
            updateData.carousel_url = null;
            updateData.music_track = parsed.musicTrack || null;
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

        // Delete stale visual/audio assets for this piece
        await supabase.from('visual_assets').delete().eq('content_piece_id', id);
        await supabase.from('audio_assets').delete().eq('content_piece_id', id);

        // Track cost
        const costUsd = estimateClaudeCost(inputTokens, outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'content_regeneration',
            topic_id: piece.topic_id,
            content_piece_id: id,
            cost_usd: costUsd,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
        });

        return NextResponse.json({
            success: true,
            pieceType,
            usage: { inputTokens, outputTokens, costUsd },
        });
    } catch (error) {
        console.error('Regenerate error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
