import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { videoGenerateSchema } from '@/lib/schemas';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, blotatoTemplateId } = videoGenerateSchema.parse(body);

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

        // All video pieces (long-form lectures + shorts) render through Blotato's
        // AI Story Video. HeyGen/Remotion were removed 2026-06-29.
        if (!piece.script) {
            return NextResponse.json(
                { success: false, error: 'Content piece has no script' },
                { status: 400 },
            );
        }

        if (!blotatoTemplateId) {
            return NextResponse.json(
                { success: false, error: 'blotatoTemplateId is required' },
                { status: 400 },
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
    } catch (error) {
        console.error('Video generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
