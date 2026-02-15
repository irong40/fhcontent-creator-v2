import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { heygen } from '@/lib/heygen';

const MAX_RETRIES = 3;

export async function GET() {
    try {
        const supabase = createAdminClient();

        // Fetch all pieces with pending HeyGen jobs
        const { data: pendingPieces, error } = await supabase
            .from('content_pieces')
            .select('id, topic_id, piece_type, heygen_job_id, retry_count')
            .eq('heygen_status', 'processing')
            .not('heygen_job_id', 'is', null);

        if (error) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 500 },
            );
        }

        if (!pendingPieces || pendingPieces.length === 0) {
            return NextResponse.json({
                success: true,
                checked: 0,
                completed: 0,
                failed: 0,
                message: 'No pending HeyGen jobs',
            });
        }

        let completed = 0;
        let failed = 0;
        let stillProcessing = 0;

        for (const piece of pendingPieces) {
            try {
                const status = await heygen.getVideoStatus(piece.heygen_job_id!);

                if (status.data.status === 'completed') {
                    // Video is done — save URL and update status
                    await supabase
                        .from('content_pieces')
                        .update({
                            video_url: status.data.video_url,
                            heygen_status: 'done',
                            status: 'produced',
                            produced_at: new Date().toISOString(),
                        })
                        .eq('id', piece.id);

                    completed++;
                } else if (status.data.status === 'failed') {
                    const retryCount = piece.retry_count ?? 0;

                    if (retryCount < MAX_RETRIES) {
                        // Retry: reset heygen_status so daily-media picks it up
                        await supabase
                            .from('content_pieces')
                            .update({
                                heygen_status: null,
                                heygen_job_id: null,
                                retry_count: retryCount + 1,
                                error_message: status.data.error || 'HeyGen rendering failed',
                            })
                            .eq('id', piece.id);

                        failed++;
                    } else {
                        // Max retries reached — mark as failed
                        await supabase
                            .from('content_pieces')
                            .update({
                                heygen_status: 'failed',
                                status: 'failed',
                                error_message: `HeyGen failed after ${MAX_RETRIES} retries: ${status.data.error || 'unknown'}`,
                            })
                            .eq('id', piece.id);

                        failed++;
                    }
                } else {
                    // Still processing
                    stillProcessing++;
                }
            } catch (e) {
                console.error(`Error checking HeyGen status for piece ${piece.id}:`, e);
                failed++;
            }
        }

        return NextResponse.json({
            success: true,
            checked: pendingPieces.length,
            completed,
            failed,
            stillProcessing,
        });
    } catch (error) {
        console.error('Check-status cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
