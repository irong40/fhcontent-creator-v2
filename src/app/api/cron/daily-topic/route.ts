import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { topicResponseSchema, contentResponseSchema } from '@/lib/schemas';
import { buildTopicPrompt, buildContentPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import { verifyTopicAgainstNotebookLM, hasGuardrail } from '@/lib/guardrail';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import type { Database } from '@/types/database';
import type { PieceType, TopicWithPersona } from '@/types/database';
import crypto from 'crypto';

export const maxDuration = 800;

const PIECE_ORDER: Record<PieceType, number> = {
    long: 1,
    short_1: 2,
    short_2: 3,
    short_3: 4,
    short_4: 5,
    carousel: 6,
    lecture: 7,
};

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lockToken = await acquireLock('daily-topic');
    if (!lockToken) {
        return NextResponse.json(
            { success: false, error: 'Workflow already running' },
            { status: 409 },
        );
    }

    try {
        const supabase = createAdminClient();

        // Only generate for personas listed in AUTO_TOPIC_PERSONA_IDS (comma-separated)
        const allowedIds = (process.env.AUTO_TOPIC_PERSONA_IDS || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);

        if (allowedIds.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'AUTO_TOPIC_PERSONA_IDS not configured — no personas to process',
                processed: 0,
            });
        }

        const { data: personas, error: personaError } = await supabase
            .from('personas')
            .select('*')
            .eq('is_active', true)
            .in('id', allowedIds);

        if (personaError || !personas || personas.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No matching active personas found',
                processed: 0,
            });
        }

        const results = [];

        // Weekly batch: Sundays generate 7 topics per persona, staggered Mon→Sun.
        // Each topic gets its own publish_date so daily-publish ships them on schedule.
        const TOPICS_PER_WEEK = 7;
        const nowMs = Date.now();
        const monday = new Date(nowMs);
        // Move to next Monday (Sunday's UTC weekday is 0)
        const utcDay = monday.getUTCDay();
        const daysToMonday = utcDay === 0 ? 1 : (8 - utcDay);
        monday.setUTCDate(monday.getUTCDate() + daysToMonday);
        monday.setUTCHours(0, 0, 0, 0);

        for (const persona of personas) {
            const personaResult = {
                personaId: persona.id,
                personaName: persona.name,
                topicsCreated: [] as Array<{ id: string; title: string; publishDate: string; cooApproved: boolean; heldForReview: boolean }>,
                skipped: false,
                skipReason: null as string | null,
                errors: [] as string[],
            };

            // Skip if a topic was created for this persona in the last 6 days (avoid
            // re-running the Sunday batch and double-generating).
            const sixDaysAgo = new Date(nowMs - 6 * 24 * 60 * 60 * 1000).toISOString();
            const { data: existingThisWeek } = await supabase
                .from('topics')
                .select('id, status')
                .eq('persona_id', persona.id)
                .gte('created_at', sixDaysAgo)
                .in('status', ['draft', 'content_generating', 'content_ready', 'approved', 'scheduled'])
                .limit(1);

            if (existingThisWeek && existingThisWeek.length > 0) {
                personaResult.skipped = true;
                personaResult.skipReason = `Already has a topic from this week (status: ${existingThisWeek[0].status})`;
                results.push(personaResult);
                continue;
            }

            // ── Step 1: Generate 7 topics in one Claude call ──
            let weekTopics: Array<{ title: string; hook: string; historicalPoints: unknown; thumbnailPrompt?: string }> = [];
            try {
                const ninetyDaysAgo = new Date(nowMs - 90 * 24 * 60 * 60 * 1000).toISOString();
                const { data: recentData } = await supabase
                    .from('published_log')
                    .select('topic_title')
                    .eq('persona_id', persona.id)
                    .gte('published_at', ninetyDaysAgo)
                    .order('published_at', { ascending: false });

                const recentTopics = (recentData || []).map(r => r.topic_title);

                const { system: topicSystem, user: topicUser } = buildTopicPrompt(persona, recentTopics, TOPICS_PER_WEEK);
                const { text: topicText, inputTokens: tIn, outputTokens: tOut } = await claude.generateContent(
                    topicSystem,
                    topicUser,
                    { maxTokens: 16000 },
                );

                await supabase.from('cost_tracking').insert({
                    service: 'claude',
                    operation: 'topic_generation_weekly',
                    cost_usd: estimateClaudeCost(tIn, tOut),
                    tokens_input: tIn,
                    tokens_output: tOut,
                });

                const topicJsonText = topicText.replace(/```json\n?|\n?```/g, '').trim();
                const topicParsed = JSON.parse(topicJsonText);
                const topicResult = topicResponseSchema.safeParse(topicParsed);
                if (!topicResult.success || topicResult.data.topics.length === 0) {
                    personaResult.errors.push('Topic generation: invalid response format');
                    results.push(personaResult);
                    continue;
                }
                weekTopics = topicResult.data.topics.slice(0, TOPICS_PER_WEEK) as typeof weekTopics;
            } catch (e) {
                personaResult.errors.push(`Weekly topic generation: ${e instanceof Error ? e.message : 'unknown'}`);
                results.push(personaResult);
                continue;
            }

            // ── Step 2: For each topic, dup-check, insert, guardrail, content-gen, schedule ──
            for (let i = 0; i < weekTopics.length; i++) {
                const topic = weekTopics[i];
                const publishDateObj = new Date(monday);
                publishDateObj.setUTCDate(publishDateObj.getUTCDate() + i);
                const publishDate = publishDateObj.toISOString().split('T')[0];

                try {
                    // Duplicate check
                    const { data: dupCheck } = await supabase.rpc('check_duplicate_topic', {
                        p_persona_id: persona.id,
                        p_title: topic.title,
                    });
                    if (dupCheck?.[0]?.is_duplicate === true) {
                        personaResult.errors.push(`Day ${i + 1} (${publishDate}): duplicate of "${dupCheck[0].similar_title}", skipped`);
                        continue;
                    }

                    // Assign voice via LRU rotation
                    const { data: voiceId } = await supabase.rpc('get_lru_voice', {
                        p_persona_id: persona.id,
                    });

                    const topicHash = crypto
                        .createHash('md5')
                        .update(topic.title.toLowerCase().trim())
                        .digest('hex');

                    const { data: inserted, error: insertError } = await supabase
                        .from('topics')
                        .insert({
                            persona_id: persona.id,
                            title: topic.title,
                            hook: topic.hook,
                            historical_points: topic.historicalPoints as unknown as Database['public']['Tables']['topics']['Insert']['historical_points'],
                            topic_hash: topicHash,
                            voice_id: voiceId || 'default',
                            thumbnail_prompt: topic.thumbnailPrompt || null,
                            status: 'draft',
                        })
                        .select()
                        .single();

                    if (insertError || !inserted) {
                        personaResult.errors.push(`Day ${i + 1}: topic insert failed: ${insertError?.message}`);
                        continue;
                    }

                    // Guardrail check
                    let heldForReview = false;
                    if (hasGuardrail(persona)) {
                        try {
                            const guardrailResult = await verifyTopicAgainstNotebookLM(
                                topic.title,
                                topic.hook,
                                persona.guardrail_notebook_ids || [],
                            );
                            await supabase.from('topics').update({
                                source_verified: guardrailResult.verified,
                                requires_review: guardrailResult.requiresReview,
                                review_reason: guardrailResult.reviewReason,
                            }).eq('id', inserted.id);

                            if (guardrailResult.requiresReview) {
                                heldForReview = true;
                            }
                        } catch {
                            await supabase.from('topics').update({
                                requires_review: true,
                                review_reason: 'Guardrail verification failed — flagged for manual review',
                            }).eq('id', inserted.id);
                            heldForReview = true;
                        }
                    }

                    if (heldForReview) {
                        personaResult.topicsCreated.push({
                            id: inserted.id,
                            title: topic.title,
                            publishDate,
                            cooApproved: false,
                            heldForReview: true,
                        });
                        continue;
                    }

                    // Generate content pieces (scripts + captions)
                    await supabase
                        .from('topics')
                        .update({ status: 'content_generating' })
                        .eq('id', inserted.id);

                    const topicWithPersona = { ...inserted, personas: persona } as unknown as TopicWithPersona;
                    const { system: contentSystem, user: contentUser } = buildContentPrompt(persona, topicWithPersona);
                    const { text: contentText, inputTokens: cIn, outputTokens: cOut } = await claude.generateContent(
                        contentSystem,
                        contentUser,
                        { maxTokens: 8192 },
                    );

                    await supabase.from('cost_tracking').insert({
                        service: 'claude',
                        operation: 'content_generation',
                        topic_id: inserted.id,
                        cost_usd: estimateClaudeCost(cIn, cOut),
                        tokens_input: cIn,
                        tokens_output: cOut,
                    });

                    const contentJsonText = contentText.replace(/```json\n?|\n?```/g, '').trim();
                    const contentParsed = JSON.parse(contentJsonText);
                    const contentResult = contentResponseSchema.safeParse(contentParsed);
                    if (!contentResult.success) {
                        await supabase.from('topics').update({ status: 'draft' }).eq('id', inserted.id);
                        personaResult.errors.push(`Day ${i + 1}: content generation invalid response`);
                        continue;
                    }

                    // Insert content pieces. NOTE: content_pieces does NOT have a
                    // content_channel column — that lives on topics. Including it here
                    // silently failed every insert (Supabase JS client doesn't throw
                    // by default), orphaning every topic since 2026-05-03. Guard with
                    // an error check so a future schema drift fails loudly.
                    let piecesInserted = 0;
                    for (const piece of contentResult.data.pieces) {
                        const pieceType = piece.pieceType as PieceType;
                        const { error: pieceErr } = await supabase.from('content_pieces').insert({
                            topic_id: inserted.id,
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
                        if (pieceErr) {
                            personaResult.errors.push(`Day ${i + 1}: piece (${pieceType}) insert failed: ${pieceErr.message}`);
                        } else {
                            piecesInserted++;
                        }
                    }

                    if (piecesInserted === 0) {
                        // Don't auto-approve a topic with no pieces — daily-publish would just fail it.
                        await supabase.from('topics').update({ status: 'draft' }).eq('id', inserted.id);
                        personaResult.errors.push(`Day ${i + 1}: zero pieces inserted, topic left as draft`);
                        continue;
                    }

                    // COO auto-approve and schedule for its day in the week
                    await supabase.from('topics').update({
                        status: 'scheduled',
                        content_ready_at: new Date().toISOString(),
                        publish_date: publishDate,
                        coo_auto_approved_at: new Date().toISOString(),
                    }).eq('id', inserted.id);

                    personaResult.topicsCreated.push({
                        id: inserted.id,
                        title: topic.title,
                        publishDate,
                        cooApproved: true,
                        heldForReview: false,
                    });
                } catch (e) {
                    personaResult.errors.push(`Day ${i + 1} (${publishDate}): ${e instanceof Error ? e.message : 'unknown'}`);
                }
            } // end per-topic loop

            if (personaResult.errors.length > 0) {
                await notifyError({
                    source: 'daily-topic',
                    message: personaResult.errors.join('; '),
                    personaName: persona.name,
                });
            }

            results.push(personaResult);
        }

        const totalScheduled = results.reduce((n, r) => n + r.topicsCreated.filter(t => t.cooApproved).length, 0);
        const totalHeld = results.reduce((n, r) => n + r.topicsCreated.filter(t => t.heldForReview).length, 0);
        return NextResponse.json({
            success: true,
            scheduled: totalScheduled,
            heldForReview: totalHeld,
            personas: results.length,
            results,
        });
    } catch (error) {
        console.error('Daily-topic cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    } finally {
        await releaseLock('daily-topic', lockToken);
    }
}
