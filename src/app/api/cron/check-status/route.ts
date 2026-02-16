import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { heygen } from '@/lib/heygen';
import { blotato } from '@/lib/blotato';
import { notifyError } from '@/lib/notifications';
import { validateCronSecret } from '../middleware';
import type { PublishedPlatforms, PlatformStatus } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 300;

const MAX_RETRIES = 3;

interface HeyGenPollResult {
    checked: number;
    completed: number;
    failed: number;
    stillProcessing: number;
}

async function pollHeyGenStatuses(supabase: SupabaseClient): Promise<HeyGenPollResult | null> {
    const { data: pendingPieces, error } = await supabase
        .from('content_pieces')
        .select('id, topic_id, piece_type, heygen_job_id, retry_count')
        .eq('heygen_status', 'processing')
        .not('heygen_job_id', 'is', null);

    if (error) throw new Error(error.message);
    if (!pendingPieces || pendingPieces.length === 0) return null;

    let completed = 0;
    let failed = 0;
    let stillProcessing = 0;

    for (const piece of pendingPieces) {
        try {
            const status = await heygen.getVideoStatus(piece.heygen_job_id!);

            if (status.data.status === 'completed') {
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
                    await supabase
                        .from('content_pieces')
                        .update({
                            heygen_status: null,
                            heygen_job_id: null,
                            retry_count: retryCount + 1,
                            error_message: status.data.error || 'HeyGen rendering failed',
                        })
                        .eq('id', piece.id);
                } else {
                    await supabase
                        .from('content_pieces')
                        .update({
                            heygen_status: 'failed',
                            status: 'failed',
                            error_message: `HeyGen failed after ${MAX_RETRIES} retries: ${status.data.error || 'unknown'}`,
                        })
                        .eq('id', piece.id);
                    await notifyError({
                        source: 'check-status',
                        message: `HeyGen failed after ${MAX_RETRIES} retries: ${status.data.error || 'unknown'}`,
                        topicId: piece.topic_id,
                    });
                }
                failed++;
            } else {
                stillProcessing++;
            }
        } catch (e) {
            console.error(`Error checking HeyGen status for piece ${piece.id}:`, e);
            failed++;
        }
    }

    return { checked: pendingPieces.length, completed, failed, stillProcessing };
}

interface BlotatoPollResult {
    checked: number;
    published: number;
    failed: number;
    stillPending: number;
}

async function pollBlotatoStatuses(supabase: SupabaseClient): Promise<BlotatoPollResult> {
    const result: BlotatoPollResult = { checked: 0, published: 0, failed: 0, stillPending: 0 };

    const { data: publishingPieces } = await supabase
        .from('content_pieces')
        .select('id, topic_id, published_platforms')
        .eq('status', 'publishing');

    if (!publishingPieces || publishingPieces.length === 0) return result;

    for (const piece of publishingPieces) {
        const platforms = (piece.published_platforms || {}) as PublishedPlatforms;
        let pieceUpdated = false;
        let allResolved = true;
        const updatedPlatforms = { ...platforms } as Record<string, PlatformStatus>;

        for (const [platform, pStatus] of Object.entries(platforms)) {
            const ps = pStatus as PlatformStatus;
            if (ps.status !== 'pending' || !ps.post_id) {
                if (ps.status === 'pending') allResolved = false;
                continue;
            }

            result.checked++;

            try {
                const postStatus = await blotato.getPostStatus(ps.post_id);

                if (postStatus.status === 'published') {
                    updatedPlatforms[platform] = {
                        status: 'published',
                        post_id: ps.post_id,
                        published_at: postStatus.publishedAt || new Date().toISOString(),
                    };
                    pieceUpdated = true;
                    result.published++;
                } else if (postStatus.status === 'failed') {
                    updatedPlatforms[platform] = {
                        status: 'failed',
                        post_id: ps.post_id,
                        error: postStatus.error || 'Publishing failed',
                    };
                    pieceUpdated = true;
                    result.failed++;
                } else {
                    allResolved = false;
                    result.stillPending++;
                }
            } catch (e) {
                console.error(`Error checking Blotato status for ${platform} (${ps.post_id}):`, e);
                allResolved = false;
                result.stillPending++;
            }
        }

        if (pieceUpdated) {
            const updateData: Record<string, unknown> = { published_platforms: updatedPlatforms };
            if (allResolved) {
                updateData.status = 'published';
                updateData.published_at = new Date().toISOString();
            }
            await supabase.from('content_pieces').update(updateData).eq('id', piece.id);
        }
    }

    // Promote topics to 'published' if all their pieces are resolved
    const topicIds = [...new Set(publishingPieces.map(p => p.topic_id))];
    for (const topicId of topicIds) {
        const { data: topicPieces } = await supabase
            .from('content_pieces')
            .select('status')
            .eq('topic_id', topicId);

        if (!topicPieces) continue;

        const allDone = topicPieces.every(
            p => p.status === 'published' || p.status === 'produced' || p.status === 'ready'
        );
        const anyPublished = topicPieces.some(p => p.status === 'published');

        if (allDone && anyPublished) {
            await supabase
                .from('topics')
                .update({ status: 'published', published_at: new Date().toISOString() })
                .eq('id', topicId)
                .eq('status', 'publishing');
        }
    }

    return result;
}

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();

        const heygenResult = await pollHeyGenStatuses(supabase);
        const blotatoResult = await pollBlotatoStatuses(supabase);

        if (!heygenResult && blotatoResult.checked === 0) {
            return NextResponse.json({
                success: true,
                message: 'No pending jobs',
                heygen: { checked: 0, completed: 0, failed: 0, stillProcessing: 0 },
                blotato: blotatoResult,
            });
        }

        return NextResponse.json({
            success: true,
            heygen: heygenResult ?? { checked: 0, completed: 0, failed: 0, stillProcessing: 0 },
            blotato: blotatoResult,
        });
    } catch (error) {
        console.error('Check-status cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
