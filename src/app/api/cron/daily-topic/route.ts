import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { topicResponseSchema } from '@/lib/schemas';
import { buildTopicPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import { verifyTopicAgainstNotebookLM, hasGuardrail } from '@/lib/guardrail';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import type { Database } from '@/types/database';
import crypto from 'crypto';

// 7 personas × 1 topic-list Claude call ≈ 90s. Keep 300s guard for safety
// margin without holding the function open.
export const maxDuration = 300;

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

            // Skip if a non-stale, valid topic was created for this persona in
            // the last 6 days (avoid re-running the Sunday batch and double-
            // generating). EXCLUDE 'draft' and 'content_generating' from the
            // skip-set: a topic stuck in those states is an artifact of a prior
            // partial run (Vercel timeout, Claude error) — left alone, the
            // persona would be skipped forever. Auto-fail those stale rows so
            // the Sunday batch can proceed cleanly.
            const sixDaysAgo = new Date(nowMs - 6 * 24 * 60 * 60 * 1000).toISOString();
            const oneDayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

            const { data: staleDrafts } = await supabase
                .from('topics')
                .select('id, title, status')
                .eq('persona_id', persona.id)
                .in('status', ['draft', 'content_generating'])
                .lt('created_at', oneDayAgo);
            if (staleDrafts && staleDrafts.length > 0) {
                for (const stale of staleDrafts) {
                    await supabase.from('topics').update({
                        status: 'failed',
                        error_message: `Auto-failed by daily-topic: stuck in ${stale.status} >24h`,
                    }).eq('id', stale.id);
                }
            }

            const { data: existingThisWeek } = await supabase
                .from('topics')
                .select('id, status')
                .eq('persona_id', persona.id)
                .gte('created_at', sixDaysAgo)
                .in('status', ['approved', 'scheduled', 'partially_published', 'published'])
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

                    // Insert with publish_date already set so the new content-
                    // generator cron can find drafts and promote them through
                    // content-gen → scheduled. Spreads the heavy 7-Claude-call
                    // content generation across 30-min ticks instead of one
                    // 800s Sunday burst that times out at the 7th topic.
                    const publishAtIso = `${publishDate}T13:00:00Z`;
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
                            publish_date: publishDate,
                            publish_at: publishAtIso,
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

                    // Topic shell created. Heavy content-pieces generation is
                    // now handled by /api/cron/content-generator (every 30 min)
                    // so this Sunday cron stays well under maxDuration even
                    // with 7 topics per persona. Topics stay status=draft with
                    // publish_date already set; the content-gen cron promotes
                    // them to status=scheduled once content_pieces are ready.
                    personaResult.topicsCreated.push({
                        id: inserted.id,
                        title: topic.title,
                        publishDate,
                        cooApproved: !heldForReview,
                        heldForReview,
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
