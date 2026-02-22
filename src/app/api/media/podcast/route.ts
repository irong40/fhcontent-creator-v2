import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { claude } from '@/lib/claude';
import { elevenlabs } from '@/lib/elevenlabs';
import { uploadAudio } from '@/lib/storage';
import { buildPodcastScriptPrompt } from '@/lib/prompts';
import { podcastGenerateSchema, podcastScriptResponseSchema } from '@/lib/schemas';
import { estimateElevenLabsCost, estimateClaudeCost, wordCount } from '@/lib/utils';
import type { ContentPiece, Topic } from '@/types/database';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { topicId, brandId } = podcastGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch the topic with its persona
        const { data: topic, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('id', topicId)
            .single();

        if (topicError || !topic) {
            return NextResponse.json(
                { success: false, error: 'Topic not found' },
                { status: 404 },
            );
        }

        // Fetch the brand for CTA template
        const { data: brand, error: brandError } = await supabase
            .from('brands')
            .select('*')
            .eq('id', brandId)
            .single();

        if (brandError || !brand) {
            return NextResponse.json(
                { success: false, error: 'Brand not found' },
                { status: 404 },
            );
        }

        // Fetch the long-form content piece script
        const { data: longPiece, error: pieceError } = await supabase
            .from('content_pieces')
            .select('*')
            .eq('topic_id', topicId)
            .eq('piece_type', 'long')
            .single();

        if (pieceError || !longPiece) {
            return NextResponse.json(
                { success: false, error: 'Long-form content piece not found for this topic' },
                { status: 404 },
            );
        }

        const piece = longPiece as ContentPiece;
        if (!piece.script) {
            return NextResponse.json(
                { success: false, error: 'Long-form content piece has no script' },
                { status: 400 },
            );
        }

        // Check if episode already exists for this topic
        const { data: existingEpisode } = await supabase
            .from('podcast_episodes')
            .select('id')
            .eq('topic_id', topicId)
            .limit(1);

        if (existingEpisode && existingEpisode.length > 0) {
            return NextResponse.json(
                { success: false, error: 'Podcast episode already exists for this topic' },
                { status: 409 },
            );
        }

        const persona = (topic as unknown as { personas: { name: string; voice_pool: string[] } }).personas;
        const ctaTemplate = brand.cta_template || `Check out ${brand.name} for more.`;

        // Generate expanded podcast script via Claude
        const { system, user } = buildPodcastScriptPrompt(
            topic as unknown as Topic,
            piece.script,
            brand.name,
            ctaTemplate,
        );

        const claudeResult = await claude.generateContent(system, user, {
            maxTokens: 8192,
        });

        // Track Claude cost
        await supabase.from('cost_tracking').insert({
            service: 'claude',
            operation: 'podcast_script',
            topic_id: topicId,
            cost_usd: estimateClaudeCost(claudeResult.inputTokens, claudeResult.outputTokens),
            tokens_input: claudeResult.inputTokens,
            tokens_output: claudeResult.outputTokens,
        });

        // Parse the Claude response
        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(claudeResult.text);
        } catch {
            return NextResponse.json(
                { success: false, error: 'AI returned invalid JSON' },
                { status: 502 },
            );
        }
        const parsed = podcastScriptResponseSchema.parse(parsedJson);

        // Replace [MID_ROLL_CTA] with the actual brand CTA
        const finalScript = parsed.script.replace('[MID_ROLL_CTA]', ctaTemplate);

        // Generate TTS audio via ElevenLabs
        // Use the topic's voice_id (assigned from persona's voice pool)
        const voiceId = topic.voice_id;
        const audioBuffer = await elevenlabs.textToSpeech(voiceId, finalScript);

        // Upload audio to Supabase storage
        const storagePath = `podcasts/${topicId}/episode.mp3`;
        const audioUrl = await uploadAudio(storagePath, audioBuffer);

        // Track ElevenLabs cost
        await supabase.from('cost_tracking').insert({
            service: 'elevenlabs',
            operation: 'podcast_tts',
            topic_id: topicId,
            cost_usd: estimateElevenLabsCost(finalScript.length),
        });

        // Derive duration from MP3 buffer size (ElevenLabs outputs 128kbps = 16000 bytes/sec)
        const durationSeconds = Math.round(audioBuffer.byteLength / 16000);
        const words = wordCount(finalScript);

        // Create podcast_episodes row
        const { data: episode, error: insertError } = await supabase
            .from('podcast_episodes')
            .insert({
                topic_id: topicId,
                brand_id: brandId,
                persona_id: topic.persona_id,
                title: parsed.title,
                script: finalScript,
                audio_url: audioUrl,
                duration_seconds: durationSeconds,
                status: 'ready',
            })
            .select()
            .single();

        if (insertError) {
            return NextResponse.json(
                { success: false, error: `Failed to create episode: ${insertError.message}` },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            episode_id: episode.id,
            audio_url: audioUrl,
            title: parsed.title,
            duration_seconds: durationSeconds,
            word_count: words,
        });
    } catch (error) {
        console.error('Podcast generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
