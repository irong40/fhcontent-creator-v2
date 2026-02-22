import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { heygen } from '@/lib/heygen';
import { blotato } from '@/lib/blotato';
import { videoGenerateSchema } from '@/lib/schemas';
import type { PieceType } from '@/types/database';

const BLOTATO_PIECE_TYPES: PieceType[] = ['short_1', 'short_2', 'short_3', 'short_4'];

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, avatarId, audioUrl, blotatoTemplateId } = videoGenerateSchema.parse(body);

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

        const isBlotato = BLOTATO_PIECE_TYPES.includes(piece.piece_type as PieceType);

        if (isBlotato) {
            // Blotato faceless video path for short-form content
            if (!blotatoTemplateId) {
                return NextResponse.json(
                    { success: false, error: 'blotatoTemplateId required for short-form video' },
                    { status: 400 },
                );
            }

            if (!piece.script) {
                return NextResponse.json(
                    { success: false, error: 'Content piece has no script' },
                    { status: 400 },
                );
            }

            const response = await blotato.createVideoFromPrompt(blotatoTemplateId, piece.script);
            const jobId = response.item.id;

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
            // HeyGen avatar video path for long-form content
            if (!avatarId || !audioUrl) {
                return NextResponse.json(
                    { success: false, error: 'avatarId and audioUrl required for long-form video' },
                    { status: 400 },
                );
            }

            const response = await heygen.createVideoFromAudio(avatarId, audioUrl);
            const videoId = response.data.video_id;

            await supabase
                .from('content_pieces')
                .update({
                    heygen_job_id: videoId,
                    heygen_status: 'processing',
                    status: 'processing',
                })
                .eq('id', contentPieceId);

            await supabase.from('cost_tracking').insert({
                service: 'heygen',
                operation: 'video_generation',
                topic_id: piece.topic_id,
                content_piece_id: contentPieceId,
                cost_usd: 0.25,
            });

            return NextResponse.json({
                success: true,
                heygenJobId: videoId,
                pieceType: piece.piece_type,
                provider: 'heygen',
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
