import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { heygen } from '@/lib/heygen';
import { videoGenerateSchema } from '@/lib/schemas';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, avatarId, audioUrl } = videoGenerateSchema.parse(body);

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

        // Submit HeyGen avatar video job
        const response = await heygen.createVideoFromAudio(avatarId, audioUrl);
        const videoId = response.data.video_id;

        // Update content piece with HeyGen job tracking
        await supabase
            .from('content_pieces')
            .update({
                heygen_job_id: videoId,
                heygen_status: 'processing',
                status: 'processing',
            })
            .eq('id', contentPieceId);

        // Track cost (estimated ~$0.10-0.50/video depending on duration)
        await supabase.from('cost_tracking').insert({
            service: 'heygen',
            operation: 'video_generation',
            topic_id: piece.topic_id,
            content_piece_id: contentPieceId,
            cost_usd: 0.25, // estimated average
        });

        return NextResponse.json({
            success: true,
            heygenJobId: videoId,
            pieceType: piece.piece_type,
        });
    } catch (error) {
        console.error('Video generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
