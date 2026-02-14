import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { topicGenerateSchema, topicResponseSchema } from '@/lib/schemas';
import { buildTopicPrompt } from '@/lib/prompts';
import type { Database } from '@/types/database';

const PIECE_ORDER = { long: 1, short_1: 2, short_2: 3, short_3: 4, short_4: 5, carousel: 6 } as const;

function estimateCost(inputTokens: number, outputTokens: number): number {
    // Claude Sonnet 4.5 pricing: $3/M input, $15/M output
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { personaId, count } = topicGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch persona
        const { data: persona, error: personaError } = await supabase
            .from('personas')
            .select('*')
            .eq('id', personaId)
            .single();

        if (personaError || !persona) {
            return NextResponse.json({ success: false, error: 'Persona not found' }, { status: 404 });
        }

        // Fetch recent topics for duplicate avoidance (last 90 days)
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recentData } = await supabase
            .from('published_log')
            .select('topic_title')
            .eq('persona_id', personaId)
            .gte('published_at', ninetyDaysAgo)
            .order('published_at', { ascending: false });

        const recentTopics = (recentData || []).map(r => r.topic_title);

        // Build prompt and call Claude
        const { system, user } = buildTopicPrompt(persona, recentTopics, count);
        const { text, inputTokens, outputTokens } = await claude.generateContent(system, user, {
            maxTokens: 4096,
        });

        // Parse and validate response
        const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = topicResponseSchema.safeParse(JSON.parse(jsonText));

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: 'Invalid AI response format', details: parsed.error.issues },
                { status: 502 },
            );
        }

        // Insert topics with voice assignment and duplicate check
        const insertedTopics = [];
        for (const topic of parsed.data.topics) {
            const topicHash = crypto
                .createHash('md5')
                .update(topic.title.toLowerCase().trim())
                .digest('hex');

            // Check for duplicates via pg_trgm similarity
            const { data: dupCheck } = await supabase.rpc('check_duplicate_topic', {
                p_persona_id: personaId,
                p_title: topic.title,
            });

            const isDuplicate = dupCheck?.[0]?.is_duplicate === true;
            if (isDuplicate) {
                insertedTopics.push({
                    title: topic.title,
                    skipped: true,
                    reason: `Similar to: ${dupCheck[0].similar_title}`,
                });
                continue;
            }

            // Assign voice via LRU rotation
            const { data: voiceId } = await supabase.rpc('get_lru_voice', {
                p_persona_id: personaId,
            });

            // Insert topic
            const { data: inserted, error: insertError } = await supabase
                .from('topics')
                .insert({
                    persona_id: personaId,
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

            if (insertError) {
                console.error('Error inserting topic:', insertError);
                continue;
            }

            insertedTopics.push({
                id: inserted.id,
                title: topic.title,
                hook: topic.hook,
                voiceId: voiceId || 'default',
            });
        }

        // Track cost
        const costUsd = estimateCost(inputTokens, outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'topic_generation',
            cost_usd: costUsd,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
        });

        return NextResponse.json({
            success: true,
            topics: insertedTopics,
            usage: { inputTokens, outputTokens, costUsd },
        });
    } catch (error) {
        console.error('Topic generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
