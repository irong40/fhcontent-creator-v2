import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { generateQueuedContent, localContentResponseSchema } from '@/lib/content-inference';
import { LocalInferencePendingError } from '@/lib/local-inference-queue';
import { z } from 'zod';
import { contentResponseSchema, quoteContentResponseSchema } from '@/lib/schemas';
import { buildContentPrompt } from '@/lib/prompts';
import { sourcedQuoteFaults, UNSOURCED_QUOTE_ERROR, rejectedSpans, closestSourceSentence, unquoteUnsourced } from '@/lib/quote-check';
import { UNSUPPORTED_CLAIM_ERROR, callJudge, hasSourcePassages, judgeClaims, unsupportedSpecifics } from '@/lib/claim-check';
import { estimateClaudeCost } from '@/lib/utils';
import { releaseDraftHolds } from '@/lib/draft-hold';
import { notifyError } from '@/lib/notifications';
import { recordTrail, topicCorrelationId } from '@/lib/judge-trail';
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

// A draft that fails more than one check stores every reason in topics.error_message,
// joined by this separator, so the retry prompt can name each one.
const CHECK_FAULT_SEPARATOR = ' || ';

/** The part of a stored error that one check wrote (from its label on), or null. */
function priorCheckFault(errorMessage: string | null | undefined, label: string): string | null {
    if (!errorMessage) return null;
    for (const part of errorMessage.split(CHECK_FAULT_SEPARATOR)) {
        const at = part.indexOf(label);
        if (at >= 0) return part.slice(at);
    }
    return null;
}

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
                await releaseDraftHolds(topic.id);
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
                const { system, user: basePrompt } = buildContentPrompt(persona, topic);
                // A draft rejected for an unsourced quotation is rewritten with the reason in
                // the prompt. The local model runs at temperature 0: the same prompt would
                // write the same caption and fail the same way three times.
                // Every check's reason goes back, not only the quote check's: a draft failed on a
                // number the sources do not hold, or by the judge, came back with the same prompt.
                const priorQuoteFault = priorCheckFault(topic.error_message, UNSOURCED_QUOTE_ERROR);
                const priorClaimFault = priorCheckFault(topic.error_message, UNSUPPORTED_CLAIM_ERROR);
                // Name the nearest exact source sentence for each rejected span so the retry
                // has words to copy, not only a rule.
                const retrySources = (topic.historical_points as HistoricalPoint[] | null ?? [])
                    .flatMap(p => [p.claim, p.quote ?? '']).filter(t => typeof t === 'string' && t.length > 0);
                const copyThese = priorQuoteFault
                    ? [...new Set(rejectedSpans(priorQuoteFault).map(s => closestSourceSentence(s, retrySources)).filter((s): s is string => !!s))]
                    : [];
                const retryReasons = [
                    priorQuoteFault ? `${priorQuoteFault}. Inside quotation marks use only words copied exactly from THE QUOTE or a SOURCE PASSAGE above. A title is not a quotation. Never put a title, a summary or a paraphrase in quotation marks.${copyThese.length ? `
If you quote the speaker, copy this sentence exactly, character for character, or leave the quotation marks out and describe it in your own words:
${copyThese.map(s => `"${s}"`).join('\n')}` : ''}` : null,
                    priorClaimFault ? `${priorClaimFault}. State only what a SOURCE PASSAGE above says. Leave out any year, number or claim that no SOURCE PASSAGE holds.` : null,
                ].filter((r): r is string => !!r);
                const user = retryReasons.length
                    ? `${basePrompt}

A PREVIOUS DRAFT WAS REJECTED. ${retryReasons.join('\n')}`
                    : basePrompt;
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
                        // Held until this attempt passes or fails, so a run that finds the claim
                        // judge unfinished checks the same draft next run (draft-hold.ts).
                        holdForTopic: topic.id,
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
                        holdForTopic: topic.id,
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

                // The judge may still be queued (Pending). Log the draft's cost once, when the checks
                // end, not on every cron run that finds the judge unfinished.
                const logCost = () => supabase.from('cost_tracking').insert({
                    service: provider,
                    operation: 'content_generation',
                    topic_id: topic.id,
                    cost_usd: provider === 'ollama' ? 0 : estimateClaudeCost(inputTokens, outputTokens),
                    tokens_input: inputTokens,
                    tokens_output: outputTokens,
                });

                const contentResult = responseSchema.safeParse(parsed);
                let judgePending = false;
                try {
                    if (!contentResult.success) {
                        // Shape/validation failure (e.g. quote under the word floor).
                        // Throw so the unified catch applies the retry circuit-breaker
                        // rather than silently resetting to draft and looping forever.
                        throw new Error(
                            `Invalid content shape: ${contentResult.error.issues.map(i => i.message).join('; ')}`,
                        );
                    }

                    // The retry was shown the exact sentence and still quoted something else: keep the
                    // words, drop the quotation marks, and let the check judge what remains.
                    if (priorQuoteFault) {
                        for (const piece of contentResult.data.pieces as Array<Record<string, unknown>>) {
                            for (const field of ['captionLong', 'captionShort', 'title']) {
                                if (typeof piece[field] === 'string') piece[field] = unquoteUnsourced(piece[field] as string, retrySources);
                            }
                        }
                    }

                    const generated = contentResult.data.pieces as Array<Record<string, unknown>>;
                    const quoteFaults = sourcedQuoteFaults(topic.historical_points as HistoricalPoint[], generated);

                    // A claim the source passages do not support is as fatal as a mis-quoted span
                    // (2026-10-18: Lafayette "double agent for the British", Barrett "threatened").
                    // The quote and number checks both run, so a draft failing both carries both
                    // reasons into its retry. The judge runs only on a draft they pass.
                    const claimPoints = topic.historical_points as HistoricalPoint[];
                    const sourced = hasSourcePassages(claimPoints);
                    const specifics = sourced ? unsupportedSpecifics(claimPoints, generated, { title: topic.title }) : [];
                    const checkFaults = [
                        quoteFaults.length > 0 ? `${UNSOURCED_QUOTE_ERROR}: ${quoteFaults.slice(0, 2).join('; ')}` : null,
                        specifics.length > 0 ? `${UNSUPPORTED_CLAIM_ERROR}: ${specifics.slice(0, 2).join('; ')}` : null,
                    ].filter((f): f is string => !!f);
                    if (checkFaults.length > 0) throw new Error(checkFaults.join(CHECK_FAULT_SEPARATOR));
                    if (sourced) {
                        const claimFaults = await judgeClaims(claimPoints, generated, (system, user) => callJudge(system, user, { topicId: topic.id, topicVersion: (topic as { text_version?: string | null }).text_version ?? 'unversioned' }));
                        // HR-7: the verdict is a recorded fact, so a rejected topic reads as judge_rejected, not as silence.
                        const judgedVersion = (topic as { text_version?: string | null }).text_version ?? 'unversioned';
                        await recordTrail(supabase, { correlation_id: topicCorrelationId(topic.id, judgedVersion), stage: 'validated', topic_id: topic.id, topic_version: judgedVersion, detail: { ok: claimFaults.length === 0, faults: claimFaults.length } });
                        if (claimFaults.length > 0) throw new Error(`${UNSUPPORTED_CLAIM_ERROR}: ${claimFaults.slice(0, 2).join('; ')}`);
                    }
                } catch (e) {
                    judgePending = e instanceof LocalInferencePendingError;
                    throw e;
                } finally {
                    if (!judgePending) await logCost();
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

                // Every provider lands in review. Since the source gate (2026-10-04)
                // the database refuses 'scheduled' without a passing source check,
                // so the old Claude path to 'scheduled' only ever failed after the
                // paid call. The source check and the text review come first.
                const { error: statusError } = await supabase.from('topics').update({
                    status: 'content_ready',
                    requires_review: true,
                    review_reason: provider === 'ollama'
                        ? 'Local model draft requires human factual review'
                        : 'Model draft requires source check and human review',
                    content_ready_at: new Date().toISOString(),
                    coo_auto_approved_at: null,
                }).eq('id', topic.id);
                if (statusError) throw new Error(statusError.message);
                {
                    const advancedVersion = (topic as { text_version?: string | null }).text_version ?? 'unversioned';
                    await recordTrail(supabase, { correlation_id: topicCorrelationId(topic.id, advancedVersion), stage: 'state_changed', topic_id: topic.id, topic_version: advancedVersion, detail: { advanced: true, to: 'content_ready' } });
                }
                await releaseDraftHolds(topic.id);
                topicResult.piecesInserted = piecesInserted;
            } catch (e) {
                if (e instanceof LocalInferencePendingError) {
                    // Leave error_message alone: a prior unsourced-quote fault feeds the retry prompt, and
                    // the queued job is keyed on that prompt. Clearing it here made the next pass build
                    // a different prompt and skip unquoteUnsourced.
                    await supabase.from('topics').update({ status: 'draft' }).eq('id', topic.id);
                    results.push({ ...topicResult, queued: true });
                    continue;
                }
                const errMsg = e instanceof Error ? e.message : 'unknown';
                // The attempt failed: its held draft must not be reused. The next attempt
                // (retry_count + 1, a new prompt) gets a new draft.
                await releaseDraftHolds(topic.id);
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
                    // HR-7: the business state (held, not advanced) and the escalation join the judge trail under one id.
                    const topicVersion = (topic as { text_version?: string | null }).text_version ?? 'unversioned';
                    // The errors row id is picked here, before escalated is written, so the escalation, its
                    // channel rows and its acknowledgement all carry the same exact error_id.
                    const trail = { correlationId: topicCorrelationId(topic.id, topicVersion), topicVersion, errorId: crypto.randomUUID() };
                    await recordTrail(supabase, { correlation_id: trail.correlationId, stage: 'state_changed', topic_id: topic.id, topic_version: topicVersion, detail: { advanced: false, to: 'held_for_review' } });
                    await recordTrail(supabase, { correlation_id: trail.correlationId, stage: 'escalated', topic_id: topic.id, topic_version: topicVersion, detail: { reason: 'retries_exhausted', error_id: trail.errorId } });
                    await notifyError({
                        trail,
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
