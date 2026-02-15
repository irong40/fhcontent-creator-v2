import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { elevenlabs } from '@/lib/elevenlabs';
import { heygen } from '@/lib/heygen';
import { uploadAudio } from '@/lib/storage';
import { estimateElevenLabsCost } from '@/lib/utils';
import type { ContentPiece, TopicWithPersona, PieceType } from '@/types/database';

const VIDEO_PIECE_TYPES: PieceType[] = ['long', 'short_1', 'short_2', 'short_3', 'short_4'];

export async function GET() {
    try {
        const supabase = createAdminClient();

        // Find topics that are content_ready but haven't had media generated
        const { data: topics, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('status', 'content_ready');

        if (topicError) {
            return NextResponse.json(
                { success: false, error: topicError.message },
                { status: 500 },
            );
        }

        if (!topics || topics.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No content_ready topics to process',
                processed: 0,
            });
        }

        const results = [];

        for (const topicRow of topics) {
            const topic = topicRow as unknown as TopicWithPersona;
            const persona = topic.personas;
            const avatarId = persona.heygen_avatar_id;

            // Fetch video pieces that need audio (no existing audio_assets)
            const { data: pieces } = await supabase
                .from('content_pieces')
                .select('id, piece_type, script, topic_id, heygen_job_id')
                .eq('topic_id', topic.id)
                .in('piece_type', VIDEO_PIECE_TYPES);

            if (!pieces || pieces.length === 0) continue;

            const topicResult = {
                topicId: topic.id,
                title: topic.title,
                audioGenerated: 0,
                videoSubmitted: 0,
                errors: [] as string[],
            };

            for (const piece of pieces as ContentPiece[]) {
                // Skip if HeyGen job already submitted
                if (piece.heygen_job_id) continue;

                if (!piece.script) {
                    topicResult.errors.push(`${piece.piece_type}: no script`);
                    continue;
                }

                // Check if audio already exists for this piece
                const { data: existingAudio } = await supabase
                    .from('audio_assets')
                    .select('id, audio_url')
                    .eq('content_piece_id', piece.id)
                    .eq('status', 'ready')
                    .limit(1);

                let audioUrl: string;

                if (existingAudio && existingAudio.length > 0) {
                    // Audio already generated, use it
                    audioUrl = existingAudio[0].audio_url!;
                } else {
                    // Generate TTS audio
                    try {
                        const audioBuffer = await elevenlabs.textToSpeech(
                            topic.voice_id,
                            piece.script,
                        );

                        const storagePath = `${topic.id}/${piece.piece_type}.mp3`;
                        audioUrl = await uploadAudio(storagePath, audioBuffer);

                        await supabase.from('audio_assets').insert({
                            content_piece_id: piece.id,
                            voice_id: topic.voice_id,
                            audio_url: audioUrl,
                            status: 'ready',
                        });

                        // Track TTS cost
                        await supabase.from('cost_tracking').insert({
                            service: 'elevenlabs',
                            operation: 'tts_generation',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: estimateElevenLabsCost(piece.script.length),
                        });

                        topicResult.audioGenerated++;
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} TTS: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                        continue; // Skip video if audio failed
                    }
                }

                // Submit HeyGen video job (only if avatar is configured)
                if (avatarId) {
                    try {
                        const videoResponse = await heygen.createVideoFromAudio(
                            avatarId,
                            audioUrl,
                        );

                        await supabase
                            .from('content_pieces')
                            .update({
                                heygen_job_id: videoResponse.data.video_id,
                                heygen_status: 'processing',
                                status: 'processing',
                            })
                            .eq('id', piece.id);

                        // Track HeyGen cost
                        await supabase.from('cost_tracking').insert({
                            service: 'heygen',
                            operation: 'video_generation',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: 0.25,
                        });

                        topicResult.videoSubmitted++;
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} HeyGen: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                    }
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
        console.error('Daily media cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
