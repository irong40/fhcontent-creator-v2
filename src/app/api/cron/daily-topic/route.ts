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

export const maxDuration = 300;

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

        for (const persona of personas) {
            const personaResult = {
                personaId: persona.id,
                personaName: persona.name,
                topicCreated: null as string | null,
                contentGenerated: false,
                skipped: false,
                skipReason: null as string | null,
                errors: [] as string[],
            };

            // Skip if a draft or in-progress topic already exists for this persona today
            const today = new Date().toISOString().split('T')[0];
            const { data: existingToday } = await supabase
                .from('topics')
                .select('id, status')
                .eq('persona_id', persona.id)
                .gte('created_at', `${today}T00:00:00Z`)
                .in('status', ['draft', 'content_generating', 'content_ready', 'approved', 'scheduled'])
                .limit(1);

            if (existingToday && existingToday.length > 0) {
                personaResult.skipped = true;
                personaResult.skipReason = `Topic already exists today (status: ${existingToday[0].status})`;
                results.push(personaResult);
                continue;
            }

            // ── Step 1: Generate topic ──
            try {
                const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
                const { data: recentData } = await supabase
                    .from('published_log')
                    .select('topic_title')
                    .eq('persona_id', persona.id)
                    .gte('published_at', ninetyDaysAgo)
                    .order('published_at', { ascending: false });

                const recentTopics = (recentData || []).map(r => r.topic_title);

                const { system: topicSystem, user: topicUser } = buildTopicPrompt(persona, recentTopics, 1);
                const { text: topicText, inputTokens: tIn, outputTokens: tOut } = await claude.generateContent(
                    topicSystem,
                    topicUser,
                    { maxTokens: 4096 },
                );

                await supabase.from('cost_tracking').insert({
                    service: 'claude',
                    operation: 'topic_generation',
                    cost_usd: estimateClaudeCost(tIn, tOut),
                    tokens_input: tIn,
                    tokens_output: tOut,
                });

                const topicJsonText = topicText.replace(/```json\n?|\n?```/g, '').trim();
                let topicParsed: unknown;
                try {
                    topicParsed = JSON.parse(topicJsonText);
                } catch {
                    personaResult.errors.push('Topic generation: AI returned invalid JSON');
                    results.push(personaResult);
                    continue;
                }

                const topicResult = topicResponseSchema.safeParse(topicParsed);
                if (!topicResult.success || topicResult.data.topics.length === 0) {
                    personaResult.errors.push('Topic generation: invalid response format');
                    results.push(personaResult);
                    continue;
                }

                const topic = topicResult.data.topics[0];

                // Duplicate check
                const { data: dupCheck } = await supabase.rpc('check_duplicate_topic', {
                    p_persona_id: persona.id,
                    p_title: topic.title,
                });
                if (dupCheck?.[0]?.is_duplicate === true) {
                    personaResult.skipped = true;
                    personaResult.skipReason = `Duplicate: similar to "${dupCheck[0].similar_title}"`;
                    results.push(personaResult);
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
                    personaResult.errors.push(`Topic insert failed: ${insertError?.message}`);
                    results.push(personaResult);
                    continue;
                }

                // Guardrail check
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
                            personaResult.topicCreated = inserted.id;
                            personaResult.skipReason = 'Guardrail: flagged for manual review — skipping content generation';
                            results.push(personaResult);
                            continue;
                        }
                    } catch (e) {
                        await supabase.from('topics').update({
                            requires_review: true,
                            review_reason: 'Guardrail verification failed — flagged for manual review',
                        }).eq('id', inserted.id);
                        personaResult.topicCreated = inserted.id;
                        personaResult.skipReason = 'Guardrail verification error — skipping content generation';
                        results.push(personaResult);
                        continue;
                    }
                }

                personaResult.topicCreated = inserted.id;

                // ── Step 2: Generate content pieces (scripts + captions) ──
                try {
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
                    let contentParsed: unknown;
                    try {
                        contentParsed = JSON.parse(contentJsonText);
                    } catch {
                        await supabase.from('topics').update({ status: 'draft' }).eq('id', inserted.id);
                        personaResult.errors.push('Content generation: AI returned invalid JSON');
                        results.push(personaResult);
                        continue;
                    }

                    const contentResult = contentResponseSchema.safeParse(contentParsed);
                    if (!contentResult.success) {
                        await supabase.from('topics').update({ status: 'draft' }).eq('id', inserted.id);
                        personaResult.errors.push('Content generation: invalid response format');
                        results.push(personaResult);
                        continue;
                    }

                    // Insert content pieces
                    const pieces = contentResult.data.pieces;
                    for (const piece of pieces) {
                        const pieceType = piece.pieceType as PieceType;
                        await supabase.from('content_pieces').insert({
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
                            content_channel: 'social',
                        });
                    }

                    await supabase.from('topics').update({
                        status: 'content_ready',
                        content_ready_at: new Date().toISOString(),
                    }).eq('id', inserted.id);

                    personaResult.contentGenerated = true;
                } catch (e) {
                    await supabase.from('topics').update({ status: 'draft' }).eq('id', inserted.id);
                    personaResult.errors.push(`Content generation: ${e instanceof Error ? e.message : 'unknown'}`);
                }
            } catch (e) {
                personaResult.errors.push(`Topic generation: ${e instanceof Error ? e.message : 'unknown'}`);
            }

            if (personaResult.errors.length > 0) {
                await notifyError({
                    source: 'daily-topic',
                    message: personaResult.errors.join('; '),
                    personaName: persona.name,
                });
            }

            results.push(personaResult);
        }

        return NextResponse.json({
            success: true,
            processed: results.filter(r => r.contentGenerated).length,
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
