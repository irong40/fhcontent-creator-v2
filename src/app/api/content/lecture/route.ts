import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { lectureGenerateSchema, lectureScriptResponseSchema } from '@/lib/schemas';
import { buildLectureScriptPrompt } from '@/lib/prompts-lecture';
import { estimateClaudeCost } from '@/lib/utils';
import type { LectureChapter, Persona, LectureData } from '@/types/database';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { chapterId } = lectureGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch chapter with persona
        const { data: chapter, error: chapterError } = await supabase
            .from('lecture_chapters')
            .select('*')
            .eq('id', chapterId)
            .single();

        if (chapterError || !chapter) {
            return NextResponse.json(
                { success: false, error: 'Chapter not found' },
                { status: 404 },
            );
        }

        const lectureChapter = chapter as unknown as LectureChapter;

        if (!lectureChapter.persona_id) {
            return NextResponse.json(
                { success: false, error: 'Chapter has no persona assigned' },
                { status: 400 },
            );
        }

        // Fetch persona
        const { data: persona, error: personaError } = await supabase
            .from('personas')
            .select('*')
            .eq('id', lectureChapter.persona_id)
            .single();

        if (personaError || !persona) {
            return NextResponse.json(
                { success: false, error: 'Persona not found' },
                { status: 404 },
            );
        }

        // Update chapter status
        await supabase
            .from('lecture_chapters')
            .update({ status: 'scripted', updated_at: new Date().toISOString() })
            .eq('id', chapterId);

        // Build prompt and call Claude
        const { system, user } = buildLectureScriptPrompt(
            persona as Persona,
            lectureChapter,
        );

        const { text, inputTokens, outputTokens } = await claude.generateContent(
            system,
            user,
            { maxTokens: 16384 },
        );

        // Parse response
        const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
        let rawParsed: unknown;
        try {
            rawParsed = JSON.parse(jsonText);
        } catch {
            await supabase
                .from('lecture_chapters')
                .update({ status: 'pending' })
                .eq('id', chapterId);
            return NextResponse.json(
                { success: false, error: 'AI returned invalid JSON' },
                { status: 502 },
            );
        }

        const parsed = lectureScriptResponseSchema.safeParse(rawParsed);
        if (!parsed.success) {
            await supabase
                .from('lecture_chapters')
                .update({ status: 'pending' })
                .eq('id', chapterId);
            return NextResponse.json(
                { success: false, error: 'Invalid AI response format', details: parsed.error.issues },
                { status: 502 },
            );
        }

        // Create topic for this lecture
        const { data: voiceData } = await supabase
            .rpc('get_lru_voice', { p_persona_id: lectureChapter.persona_id! });

        const voiceId = voiceData || (persona as Persona).voice_pool[0];

        const lectureData: LectureData = {
            chapter_number: lectureChapter.chapter_number,
            week_number: lectureChapter.week_number,
            learning_objectives: lectureChapter.learning_objectives || [],
            key_concepts: lectureChapter.key_concepts || [],
            field_connections: lectureChapter.field_connections || [],
            scenes: parsed.data.scenes,
        };

        // Combine all scene narrations into the full lecture script
        const fullScript = parsed.data.scenes
            .map((s: { narration: string }) => s.narration)
            .join('\n\n');

        const topicHash = `lecture-ch${lectureChapter.chapter_number}-${Date.now()}`;

        const { data: topic, error: topicError } = await supabase
            .from('topics')
            .insert({
                persona_id: lectureChapter.persona_id!,
                title: parsed.data.title,
                hook: parsed.data.summary,
                historical_points: [] as never,
                topic_hash: topicHash,
                voice_id: voiceId,
                content_channel: 'lecture',
                lecture_data: lectureData as never,
                status: 'content_ready',
                content_ready_at: new Date().toISOString(),
            })
            .select()
            .single();

        if (topicError || !topic) {
            return NextResponse.json(
                { success: false, error: `Failed to create topic: ${topicError?.message}` },
                { status: 500 },
            );
        }

        // Create single lecture content piece with full script
        const { data: piece, error: pieceError } = await supabase
            .from('content_pieces')
            .insert({
                topic_id: topic.id,
                piece_type: 'lecture',
                piece_order: 1,
                script: fullScript,
                content_channel: 'lecture',
                status: 'ready',
            })
            .select()
            .single();

        if (pieceError) {
            console.error('Error inserting lecture piece:', pieceError);
        }

        // Link chapter to topic
        await supabase
            .from('lecture_chapters')
            .update({ topic_id: topic.id, status: 'scripted' })
            .eq('id', chapterId);

        // Track cost
        const costUsd = estimateClaudeCost(inputTokens, outputTokens);
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'lecture_script_generation',
            topic_id: topic.id,
            cost_usd: costUsd,
            tokens_input: inputTokens,
            tokens_output: outputTokens,
        });

        return NextResponse.json({
            success: true,
            topicId: topic.id,
            pieceId: piece?.id,
            title: parsed.data.title,
            sceneCount: parsed.data.scenes.length,
            estimatedDuration: `${Math.round(parsed.data.total_duration_estimate_seconds / 60)} min`,
            usage: { inputTokens, outputTokens, costUsd },
        });
    } catch (error) {
        console.error('Lecture generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
