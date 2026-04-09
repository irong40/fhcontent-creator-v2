import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { remotionRenderer } from '@/lib/remotion-renderer';
import { blotato } from '@/lib/blotato';
import { videoGenerateSchema } from '@/lib/schemas';
import type { PieceType } from '@/types/database';

const BLOTATO_PIECE_TYPES: PieceType[] = ['short_1', 'short_2', 'short_3', 'short_4'];

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, audioUrl, blotatoTemplateId } = videoGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Verify content piece exists
        const { data: piece, error: fetchError } = await supabase
            .from('content_pieces')
            .select('id, topic_id, piece_type, script')
            .eq('id', contentPieceId)
            .single();

        if (fetchError || !piece) {
            return NextResponse.json(
                { success: false, error: 'Content piece not found' },
                { status: 404 },
            );
        }

        // Load topic for title context
        const { data: topic } = await supabase
            .from('topics')
            .select('title, hook')
            .eq('id', piece.topic_id)
            .single();

        const isShortForm = BLOTATO_PIECE_TYPES.includes(piece.piece_type as PieceType);

        if (isShortForm) {
            // Short-form: try Remotion first, fall back to Blotato
            if (!piece.script) {
                return NextResponse.json(
                    { success: false, error: 'Content piece has no script' },
                    { status: 400 },
                );
            }

            // Check if Remotion render server is available
            const remotionHealth = await remotionRenderer.testConnection();

            if (remotionHealth.ok) {
                // Render locally via Remotion
                const response = await remotionRenderer.createShortClip(
                    topic?.title || 'Training Clip',
                    piece.script,
                    { audioUrl: audioUrl || undefined },
                );

                await supabase
                    .from('content_pieces')
                    .update({
                        heygen_job_id: response.jobId, // reuse column for render job tracking
                        heygen_status: 'processing',
                        status: 'processing',
                    })
                    .eq('id', contentPieceId);

                await supabase.from('cost_tracking').insert({
                    service: 'remotion',
                    operation: 'short_clip',
                    topic_id: piece.topic_id,
                    content_piece_id: contentPieceId,
                    cost_usd: 0.00, // local rendering, no API cost
                });

                return NextResponse.json({
                    success: true,
                    jobId: response.jobId,
                    pieceType: piece.piece_type,
                    provider: 'remotion',
                });
            }

            // Fallback to Blotato if Remotion unavailable
            if (!blotatoTemplateId) {
                return NextResponse.json(
                    { success: false, error: 'Remotion render server unavailable and no blotatoTemplateId provided' },
                    { status: 503 },
                );
            }

            const blotatoResponse = await blotato.createVideoFromPrompt(blotatoTemplateId, piece.script);
            const jobId = blotatoResponse.item.id;

            await supabase
                .from('content_pieces')
                .update({
                    blotato_job_id: jobId,
                    blotato_status: 'processing',
                    status: 'processing',
                })
                .eq('id', contentPieceId);

            await supabase.from('cost_tracking').insert({
                service: 'blotato',
                operation: 'faceless_video',
                topic_id: piece.topic_id,
                content_piece_id: contentPieceId,
                cost_usd: 0.10,
            });

            return NextResponse.json({
                success: true,
                blotatoJobId: jobId,
                pieceType: piece.piece_type,
                provider: 'blotato',
            });
        } else {
            // Long-form: Remotion training video (replaces HeyGen avatar)
            if (!audioUrl) {
                return NextResponse.json(
                    { success: false, error: 'audioUrl required for long-form video' },
                    { status: 400 },
                );
            }

            const response = await remotionRenderer.createTrainingVideo(
                topic?.title || 'Training Video',
                audioUrl,
                {
                    subtitle: topic?.hook || undefined,
                },
            );

            await supabase
                .from('content_pieces')
                .update({
                    heygen_job_id: response.jobId,
                    heygen_status: 'processing',
                    status: 'processing',
                })
                .eq('id', contentPieceId);

            await supabase.from('cost_tracking').insert({
                service: 'remotion',
                operation: 'training_video',
                topic_id: piece.topic_id,
                content_piece_id: contentPieceId,
                cost_usd: 0.00, // local rendering
            });

            return NextResponse.json({
                success: true,
                jobId: response.jobId,
                pieceType: piece.piece_type,
                provider: 'remotion',
            });
        }
    } catch (error) {
        console.error('Video generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
