import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { buildNewsletterDraftPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import type { TopicWithPersona, ContentPiece } from '@/types/database';
import { z } from 'zod';

const requestSchema = z.object({
    topicId: z.string().uuid(),
});

const responseSchema = z.object({
    subject: z.string(),
    previewText: z.string(),
    body: z.string(),
    estimatedReadTime: z.number().optional(),
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { topicId } = requestSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch topic with persona
        const { data: topicData, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('id', topicId)
            .single();

        if (topicError || !topicData) {
            return NextResponse.json(
                { success: false, error: 'Topic not found' },
                { status: 404 },
            );
        }

        const topic = topicData as unknown as TopicWithPersona;
        const persona = topic.personas;

        // Fetch the long-form script
        const { data: longPiece, error: pieceError } = await supabase
            .from('content_pieces')
            .select('script')
            .eq('topic_id', topicId)
            .eq('piece_type', 'long')
            .single();

        if (pieceError || !longPiece?.script) {
            return NextResponse.json(
                { success: false, error: 'Long-form script not found for this topic' },
                { status: 404 },
            );
        }

        // Generate newsletter draft via Claude
        const { system, user } = buildNewsletterDraftPrompt(
            persona,
            topic,
            longPiece.script,
        );

        const { text, inputTokens, outputTokens } = await claude.generateContent(
            system,
            user,
            { maxTokens: 4096 },
        );

        // Parse response
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

        const parsed = responseSchema.safeParse(rawParsed);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid AI response format', details: parsed.error.issues },
                { status: 502 },
            );
        }

        // Track cost
        const costUsd = estimateClaudeCost(inputTokens, outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'newsletter_draft',
            topic_id: topicId,
            cost_usd: costUsd,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
        });

        return NextResponse.json({
            success: true,
            draft: parsed.data,
            usage: { inputTokens, outputTokens, costUsd },
        });
    } catch (error) {
        console.error('Newsletter draft generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
