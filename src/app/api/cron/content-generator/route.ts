import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { contentResponseSchema, quoteContentResponseSchema } from '@/lib/schemas';
import { buildContentPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import type { Database, PieceType, TopicWithPersona } from '@/types/database';

// Drains topic drafts created by daily-topic. Generates content_pieces and
// promotes draft → scheduled. Caps work per run so we don't reproduce the
// daily-topic 800s timeout that prompted this split.
export const maxDuration = 300;
const MAX_TOPICS_PER_RUN = 2;

const PIECE_ORDER: Record<PieceType, number> = {
    long: 1,
    short_1: 2,
    short_2: 3,
    short_3: 4,
    short_4: 5,
    carousel: 6,
    lecture: 7,
    quote_video: 1,
};

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lockToken = await acquireLock('content-generator');
    if (!lockToken) {
        return NextResponse.json(
            { success: false, error: 'Workflow already running' },
            { status: 409 },
        );
    }

    try {
        const supabase = createAdminClient();

        // Find drafts ready for content generation: status=draft, publish_date set,
        // not held for review, no content_pieces yet. Order by publish_date so
        // the next-to-publish drafts get content first.
        const { data: drafts, error } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('status', 'draft')
            .not('publish_date', 'is', null)
            .or('requires_review.is.null,requires_review.eq.false')
            .order('publish_date', { ascending: true })
            .limit(MAX_TOPICS_PER_RUN);

        if (error) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 500 },
            );
        }

        if (!drafts || drafts.length === 0) {
            return NextResponse.json({ success: true, processed: 0, message: 'No drafts to drain' });
        }

        const results = [];

        for (const draftRow of drafts) {
            const topic = draftRow as unknown as TopicWithPersona;
            const persona = topic.personas;
            const topicResult = {
                topicId: topic.id,
                title: topic.title,
                personaName: persona.name,
                piecesInserted: 0,
                error: null as string | null,
            };

            // Skip if pieces already exist (race-safe)
            const { count: existingCount } = await supabase
                .from('content_pieces')
                .select('id', { count: 'exact', head: true })
                .eq('topic_id', topic.id);

            if (existingCount && existingCount > 0) {
                // Pieces already exist — promote to scheduled (auto-recover from
                // a prior partial run that inserted pieces but never updated
                // topic status).
                await supabase.from('topics').update({
                    status: 'scheduled',
                    content_ready_at: new Date().toISOString(),
                    coo_auto_approved_at: new Date().toISOString(),
                }).eq('id', topic.id);
                topicResult.piecesInserted = existingCount;
                results.push(topicResult);
                continue;
            }

            await supabase
                .from('topics')
                .update({ status: 'content_generating' })
                .eq('id', topic.id);

            try {
                const { system, user } = buildContentPrompt(persona, topic);
                const { text, inputTokens, outputTokens } = await claude.generateContent(
                    system,
                    user,
                    { maxTokens: 8192 },
                );

                await supabase.from('cost_tracking').insert({
                    service: 'claude',
                    operation: 'content_generation',
                    topic_id: topic.id,
                    cost_usd: estimateClaudeCost(inputTokens, outputTokens),
                    tokens_input: inputTokens,
                    tokens_output: outputTokens,
                });

                const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
                const parsed = JSON.parse(jsonText);
                // quote_video personas return 1 piece; standard personas return 6.
                const responseSchema = persona.content_format === 'quote_video'
                    ? quoteContentResponseSchema
                    : contentResponseSchema;
                const contentResult = responseSchema.safeParse(parsed);
                if (!contentResult.success) {
                    await supabase.from('topics').update({ status: 'draft' }).eq('id', topic.id);
                    topicResult.error = 'Invalid Claude response shape';
                    results.push(topicResult);
                    continue;
                }

                let piecesInserted = 0;
                for (const piece of contentResult.data.pieces as Array<{
                    pieceType: PieceType;
                    script: string;
                    captionLong: string;
                    captionShort: string;
                    thumbnailPrompt?: string;
                    carouselSlides?: unknown;
                    musicTrack?: string;
                }>) {
                    const pieceType = piece.pieceType as PieceType;
                    const { error: pieceErr } = await supabase.from('content_pieces').insert({
                        topic_id: topic.id,
                        piece_type: pieceType,
                        piece_order: PIECE_ORDER[pieceType] ?? 99,
                        script: piece.script || null,
                        caption_long: piece.captionLong || null,
                        caption_short: piece.captionShort || null,
                        thumbnail_prompt: piece.thumbnailPrompt || null,
                        carousel_slides: piece.carouselSlides
                            ? (piece.carouselSlides as unknown as Database['public']['Tables']['content_pieces']['Insert']['carousel_slides'])
                            : null,
                        music_track: piece.musicTrack || null,
                        status: 'pending',
                    });
                    if (!pieceErr) piecesInserted++;
                }

                if (piecesInserted === 0) {
                    await supabase.from('topics').update({
                        status: 'draft',
                        error_message: 'Content-generator: zero pieces inserted',
                    }).eq('id', topic.id);
                    topicResult.error = 'Zero pieces inserted';
                } else {
                    await supabase.from('topics').update({
                        status: 'scheduled',
                        content_ready_at: new Date().toISOString(),
                        coo_auto_approved_at: new Date().toISOString(),
                    }).eq('id', topic.id);
                    topicResult.piecesInserted = piecesInserted;
                }
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : 'unknown';
                await supabase.from('topics').update({
                    status: 'draft',
                    error_message: `Content-generator: ${errMsg}`,
                }).eq('id', topic.id);
                topicResult.error = errMsg;
                await notifyError({
                    source: 'content-generator',
                    message: errMsg,
                    topicId: topic.id,
                    personaName: persona.name,
                });
            }

            results.push(topicResult);
        }

        return NextResponse.json({
            success: true,
            processed: results.length,
            results,
        });
    } catch (error) {
        console.error('Content-generator cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    } finally {
        await releaseLock('content-generator', lockToken);
    }
}
