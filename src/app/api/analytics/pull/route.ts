import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';

/**
 * POST /api/analytics/pull
 *
 * Pulls post analytics from Blotato for all published content pieces
 * and stores snapshots in the performance_metrics table.
 *
 * Each call captures a point-in-time snapshot so we can track growth over time.
 */
export async function POST() {
    const supabase = createAdminClient();

    // Get all published content pieces that have blotato post submissions
    const { data: pieces, error: piecesError } = await supabase
        .from('content_pieces')
        .select('id, published_platforms')
        .eq('status', 'published');

    if (piecesError) {
        return NextResponse.json({ error: piecesError.message }, { status: 500 });
    }

    if (!pieces || pieces.length === 0) {
        return NextResponse.json({ message: 'No published pieces to pull analytics for', pulled: 0 });
    }

    const results: Array<{ content_piece_id: string; platform: string; success: boolean; error?: string }> = [];

    for (const piece of pieces) {
        const platforms = piece.published_platforms as Record<string, {
            status?: string;
            post_id?: string;
        }> | null;

        if (!platforms) continue;

        for (const [platform, platformData] of Object.entries(platforms)) {
            if (!platformData?.post_id || platformData.status !== 'published') continue;

            try {
                const postStatus = await blotato.getPostStatus(platformData.post_id);

                // Blotato's getPostStatus returns: id, status, createdAt, publishedAt, error, platformPostId
                // It does NOT return engagement metrics (views, likes, shares, saves, comments).
                // Only insert a row if at least one metric has a real value to avoid polluting
                // the performance_metrics table with all-zero rows.
                const statusData = postStatus as unknown as Record<string, unknown>;
                const metrics = {
                    content_piece_id: piece.id,
                    platform,
                    views: typeof statusData.views === 'number' ? statusData.views : 0,
                    likes: typeof statusData.likes === 'number' ? statusData.likes : 0,
                    shares: typeof statusData.shares === 'number' ? statusData.shares : 0,
                    saves: typeof statusData.saves === 'number' ? statusData.saves : 0,
                    comments: typeof statusData.comments === 'number' ? statusData.comments : 0,
                };

                const hasRealMetrics = metrics.views + metrics.likes + metrics.shares + metrics.saves + metrics.comments > 0;

                if (!hasRealMetrics) {
                    results.push({ content_piece_id: piece.id, platform, success: true, error: 'No engagement data available from Blotato' });
                    continue;
                }

                const { error: insertError } = await supabase
                    .from('performance_metrics')
                    .insert(metrics);

                if (insertError) {
                    results.push({ content_piece_id: piece.id, platform, success: false, error: insertError.message });
                } else {
                    results.push({ content_piece_id: piece.id, platform, success: true });
                }
            } catch (e) {
                results.push({
                    content_piece_id: piece.id,
                    platform,
                    success: false,
                    error: e instanceof Error ? e.message : 'Unknown error',
                });
            }
        }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return NextResponse.json({
        message: `Analytics pull complete`,
        pulled: succeeded,
        failed,
        details: results,
    });
}
