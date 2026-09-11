import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { generateQueuedContent, localContentResponseSchema } from '@/lib/content-inference';
import { LocalInferencePendingError } from '@/lib/local-inference-queue';
import { z } from 'zod';
import { contentResponseSchema, quoteContentResponseSchema } from '@/lib/schemas';
import { buildContentPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import type { Database, PieceType, TopicWithPersona, HistoricalPoint } from '@/types/database';

// Drains topic drafts created by daily-topic. Generates content_pieces and
// promotes draft → scheduled. Caps work per run so we don't reproduce the
// daily-topic 800s timeout that prompted this split.
export const maxDuration = 300;
const MAX_TOPICS_PER_RUN = 2;
// After this many failed generation attempts a topic is held for manual review
// (requires_review=true) instead of being re-selected every run. Prevents a
// single malformed topic from looping forever and flooding the alert channel.
const MAX_RETRIES = 3;

// Flat scalar tool schema for the quote path: the model returns ONLY the two
// captions. There is no array/object field for the model to (mis)serialize as a
// JSON string, which is what kept reintroducing the parse failures. The on-
// screen script is built deterministically in code (see GET). Authoritative
// validation still runs through the zod response schema via safeParse below.
const QUOTE_CAPTIONS_TOOL_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {
        captionLong: { type: 'string' },
        captionShort: { type: 'string' },
    },
    required: ['captionLong', 'captionShort'],
    additionalProperties: false,
};

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
                // A prior insert may have completed before its status update.
                // Provider/approval is uncertain, so recovery always requires review.
                await supabase.from('topics').update({
                    status: 'content_ready',
                    requires_review: true,
                    review_reason: 'Recovered existing content; review before approval',
                    content_ready_at: new Date().toISOString(),
                    coo_auto_approved_at: null,
                }).eq('id', topic.id);
                topicResult.piecesInserted = existingCount;
                results.push(topicResult);
                continue;
            }

            // Local work survives a serverless timeout as a durable job. Keep
            // its topic selectable until a completed response is consumed.
            if (process.env.CONTENT_INFERENCE_PROVIDER !== 'ollama') {
                await supabase.from('topics').update({ status: 'content_generating' }).eq('id', topic.id);
            }

            try {
                const { system, user } = buildContentPrompt(persona, topic);
                // quote_video personas return 1 piece; standard personas return 6.
                const isQuote = persona.content_format === 'quote_video';
                const responseSchema = isQuote
                    ? quoteContentResponseSchema
                    : contentResponseSchema;

                let parsed: unknown;
                let inputTokens: number;
                let outputTokens: number;
                let provider: 'ollama' | 'claude';

                if (isQuote) {
                    // Robust quote path. The on-screen script is fully
                    // deterministic — the verbatim quote (topic point 1) plus an
                    // attribution line — so we assemble it in code. The quote
                    // text, which is what kept breaking model-authored JSON, never
                    // round-trips through the model. The model returns ONLY the two
                    // captions, as flat scalar tool fields, so there is no array to
                    // be serialized into a broken JSON string.
                    const points = topic.historical_points as HistoricalPoint[];
                    const quote = points[0];
                    const figureName = topic.title.split(':')[0].trim();
                    const script = `${quote.claim}\n\n— ${figureName}, ${quote.source}, ${quote.year}`;

                    const captionsSystem = `${system}

OUTPUT VIA TOOL: The on-screen script is assembled separately — you do NOT write it. Call the \`emit_quote_captions\` tool and provide ONLY captionLong and captionShort as plain text values (the tool handles all encoding; do not add quotes, backslashes, or escaping).`;

                    const response = await generateQueuedContent({
                        requestKey: `content:${topic.id}:captions:${topic.retry_count ?? 0}`,
                        system: captionsSystem.replace('Call the `emit_quote_captions` tool', 'Return JSON'),
                        user,
                        schema: QUOTE_CAPTIONS_TOOL_SCHEMA,
                        maxTokens: 4096,
                    });
                    const data = JSON.parse(response.text);
                    const { inputTokens: it, outputTokens: ot } = response;
                    provider = response.provider;
                    inputTokens = it;
                    outputTokens = ot;
                    parsed = {
                        pieces: [{
                            pieceType: 'quote_video',
                            script,
                            captionLong: data.captionLong,
                            captionShort: data.captionShort,
                        }],
                    };
                } else {
                    // Standard 6-piece path: unchanged text-mode generation.
                    const response = await generateQueuedContent({
                        requestKey: `content:${topic.id}:pieces:${topic.retry_count ?? 0}`,
                        // Reserve enough input room for the actual ~9 KB source
                        // prompts. Output truncation still fails worker validation.
                        system, user, maxTokens: process.env.CONTENT_INFERENCE_PROVIDER === 'ollama' ? 6144 : 8192,
                        schema: process.env.CONTENT_INFERENCE_PROVIDER === 'ollama'
                            ? z.toJSONSchema(localContentResponseSchema) : undefined,
                    });
                    const { text, inputTokens: it, outputTokens: ot } = response;
                    provider = response.provider;
                    inputTokens = it;
                    outputTokens = ot;
                    const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
                    parsed = JSON.parse(jsonText);
                }

                await supabase.from('cost_tracking').insert({
                    service: provider,
                    operation: 'content_generation',
                    topic_id: topic.id,
                    cost_usd: provider === 'ollama' ? 0 : estimateClaudeCost(inputTokens, outputTokens),
                    tokens_input: inputTokens,
                    tokens_output: outputTokens,
                });

                const contentResult = responseSchema.safeParse(parsed);
                if (!contentResult.success) {
                    // Shape/validation failure (e.g. quote under the word floor).
                    // Throw so the unified catch applies the retry circuit-breaker
                    // rather than silently resetting to draft and looping forever.
                    throw new Error(
                        `Invalid content shape: ${contentResult.error.issues.map(i => i.message).join('; ')}`,
                    );
                }

                const pieces = contentResult.data.pieces as Array<{
                    pieceType: PieceType;
                    script: string;
                    captionLong: string;
                    captionShort: string;
                    thumbnailPrompt?: string;
                    carouselSlides?: unknown;
                    musicTrack?: string;
                }>;
                const rows = pieces.map(piece => {
                    const pieceType = piece.pieceType as PieceType;
                    return {
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
                        status: 'pending' as const,
                    };
                });
                const { error: insertError } = await supabase.from('content_pieces').insert(rows);
                if (insertError) throw new Error(insertError.message);
                const piecesInserted = rows.length;

                const { error: statusError } = await supabase.from('topics').update({
                    status: provider === 'ollama' ? 'content_ready' : 'scheduled',
                    requires_review: provider === 'ollama',
                    review_reason: provider === 'ollama' ? 'Local model draft requires human factual review' : null,
                    content_ready_at: new Date().toISOString(),
                    coo_auto_approved_at: provider === 'ollama' ? null : new Date().toISOString(),
                }).eq('id', topic.id);
                if (statusError) throw new Error(statusError.message);
                topicResult.piecesInserted = piecesInserted;
            } catch (e) {
                if (e instanceof LocalInferencePendingError) {
                    await supabase.from('topics').update({ status: 'draft', error_message: null }).eq('id', topic.id);
                    results.push({ ...topicResult, queued: true });
                    continue;
                }
                const errMsg = e instanceof Error ? e.message : 'unknown';
                // Circuit-breaker: count the attempt; once retries are exhausted
                // hold the topic for manual review (requires_review excludes it
                // from the draft-selection query) instead of resetting to
                // 'draft' to be re-picked next run. Only the final, exhausting
                // failure pages — earlier attempts just increment the counter —
                // so one bad topic can no longer flood the alert channel.
                const nextRetry = (topic.retry_count ?? 0) + 1;
                const exhausted = nextRetry >= MAX_RETRIES;
                await supabase.from('topics').update({
                    status: 'draft',
                    retry_count: nextRetry,
                    requires_review: exhausted ? true : (topic.requires_review ?? false),
                    review_reason: exhausted
                        ? `Content-generator failed ${nextRetry}× — needs manual review`
                        : (topic.review_reason ?? null),
                    error_message: `Content-generator: ${errMsg}`,
                }).eq('id', topic.id);
                topicResult.error = errMsg;
                if (exhausted) {
                    await notifyError({
                        source: 'content-generator',
                        message: `Held for review after ${nextRetry} failed attempts: ${errMsg}`,
                        topicId: topic.id,
                        personaName: persona.name,
                    });
                }
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
