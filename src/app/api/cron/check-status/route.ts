import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { heygen } from '@/lib/heygen';
import { blotato } from '@/lib/blotato';
import { claude } from '@/lib/claude';
import { buildNewsletterDraftPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { cleanStaleLocks } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import type { PublishedPlatforms, PlatformStatus, TopicWithPersona } from '@/types/database';
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

interface BlotatoVideoPollResult {
    checked: number;
    completed: number;
    failed: number;
    stillProcessing: number;
}

async function pollBlotatoVideoStatuses(supabase: SupabaseClient): Promise<BlotatoVideoPollResult | null> {
    const { data: pendingPieces, error } = await supabase
        .from('content_pieces')
        .select('id, topic_id, piece_type, blotato_job_id, retry_count')
        .eq('blotato_status', 'processing')
        .not('blotato_job_id', 'is', null);

    if (error) throw new Error(error.message);
    if (!pendingPieces || pendingPieces.length === 0) return null;

    let completed = 0;
    let failed = 0;
    let stillProcessing = 0;

    for (const piece of pendingPieces) {
        try {
            const status = await blotato.getVideoStatus(piece.blotato_job_id!);

            if (status.item.status === 'Done') {
                await supabase
                    .from('content_pieces')
                    .update({
                        video_url: status.item.mediaUrl,
                        blotato_status: 'done',
                        status: 'produced',
                        produced_at: new Date().toISOString(),
                    })
                    .eq('id', piece.id);
                completed++;
            } else if (status.item.status === 'Failed') {
                const retryCount = piece.retry_count ?? 0;
                if (retryCount < MAX_RETRIES) {
                    await supabase
                        .from('content_pieces')
                        .update({
                            blotato_status: null,
                            blotato_job_id: null,
                            retry_count: retryCount + 1,
                            error_message: 'Blotato video rendering failed',
                        })
                        .eq('id', piece.id);
                } else {
                    await supabase
                        .from('content_pieces')
                        .update({
                            blotato_status: 'failed',
                            status: 'failed',
                            error_message: `Blotato failed after ${MAX_RETRIES} retries`,
                        })
                        .eq('id', piece.id);
                    await notifyError({
                        source: 'check-status',
                        message: `Blotato video failed after ${MAX_RETRIES} retries`,
                        topicId: piece.topic_id,
                    });
                }
                failed++;
            } else {
                stillProcessing++;
            }
        } catch (e) {
            console.error(`Error checking Blotato video status for piece ${piece.id}:`, e);
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
    newlyPublishedTopicIds: string[];
}

async function pollBlotatoStatuses(supabase: SupabaseClient): Promise<BlotatoPollResult> {
    const result: BlotatoPollResult = { checked: 0, published: 0, failed: 0, stillPending: 0, newlyPublishedTopicIds: [] };

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

    // Promote topics based on piece resolution status
    const topicIds = [...new Set(publishingPieces.map(p => p.topic_id))];
    for (const topicId of topicIds) {
        const { data: topicPieces } = await supabase
            .from('content_pieces')
            .select('id, status, published_platforms')
            .eq('topic_id', topicId);

        if (!topicPieces) continue;

        // Check if all pieces with published_platforms have fully resolved statuses
        const piecesWithPlatforms = topicPieces.filter(
            p => p.published_platforms && Object.keys(p.published_platforms as Record<string, unknown>).length > 0,
        );
        const allPlatformsResolved = piecesWithPlatforms.every(p => {
            const platforms = p.published_platforms as Record<string, { status: string }>;
            return Object.values(platforms).every(ps => ps.status !== 'pending');
        });

        if (!allPlatformsResolved) continue;

        // Count successes and failures across all platforms
        let totalPublished = 0;
        let totalFailed = 0;
        for (const p of piecesWithPlatforms) {
            const platforms = p.published_platforms as Record<string, { status: string }>;
            for (const ps of Object.values(platforms)) {
                if (ps.status === 'published') totalPublished++;
                if (ps.status === 'failed') totalFailed++;
            }
        }

        const now = new Date().toISOString();
        if (totalFailed === 0 && totalPublished > 0) {
            await supabase
                .from('topics')
                .update({ status: 'published', published_at: now })
                .eq('id', topicId)
                .in('status', ['publishing', 'partially_published']);
            result.newlyPublishedTopicIds.push(topicId);
        } else if (totalPublished > 0 && totalFailed > 0) {
            await supabase
                .from('topics')
                .update({
                    status: 'partially_published',
                    published_at: now,
                    error_message: `${totalPublished} succeeded, ${totalFailed} failed`,
                })
                .eq('id', topicId)
                .in('status', ['publishing', 'partially_published']);
        } else if (totalPublished === 0 && totalFailed > 0) {
            await supabase
                .from('topics')
                .update({ status: 'failed', error_message: 'All platform publishes failed' })
                .eq('id', topicId)
                .eq('status', 'publishing');
        }

        // Update individual piece statuses
        for (const p of piecesWithPlatforms) {
            const platforms = p.published_platforms as Record<string, { status: string }>;
            const pieceStatuses = Object.values(platforms).map(ps => ps.status);
            const anyPiecePublished = pieceStatuses.includes('published');
            if (anyPiecePublished) {
                await supabase.from('content_pieces')
                    .update({ status: 'published', published_at: now })
                    .eq('id', p.id)
                    .eq('status', 'publishing');
            }
        }
    }

    return result;
}

/**
 * Auto-generate newsletter drafts for newly published topics.
 * Stores the draft as a content_piece with piece_type context and content_channel = 'newsletter'.
 */
async function generateNewsletterDrafts(
    supabase: SupabaseClient,
    publishedTopicIds: string[],
): Promise<number> {
    let draftsGenerated = 0;

    for (const topicId of publishedTopicIds) {
        // Skip if a newsletter draft already exists for this topic
        const { data: existing } = await supabase
            .from('content_pieces')
            .select('id')
            .eq('topic_id', topicId)
            .eq('content_channel', 'newsletter')
            .limit(1);

        if (existing && existing.length > 0) continue;

        // Fetch topic + persona
        const { data: topicData } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('id', topicId)
            .single();

        if (!topicData) continue;
        const topic = topicData as unknown as TopicWithPersona;
        const persona = topic.personas;

        // Skip if persona has no newsletter CTA configured
        if (!persona.newsletter_cta && !persona.newsletter_url) continue;

        // Fetch the long-form script
        const { data: longPiece } = await supabase
            .from('content_pieces')
            .select('script')
            .eq('topic_id', topicId)
            .eq('piece_type', 'long')
            .single();

        if (!longPiece?.script) continue;

        try {
            const { system, user } = buildNewsletterDraftPrompt(persona, topic, longPiece.script);
            const { text, inputTokens, outputTokens } = await claude.generateContent(
                system,
                user,
                { maxTokens: 4096 },
            );

            const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(jsonText);

            if (parsed.subject && parsed.body) {
                await supabase.from('content_pieces').insert({
                    topic_id: topicId,
                    piece_type: 'long',
                    piece_order: 7,
                    script: parsed.body,
                    caption_long: parsed.subject,
                    caption_short: parsed.previewText || null,
                    content_channel: 'newsletter',
                    status: 'ready',
                });

                const costUsd = estimateClaudeCost(inputTokens, outputTokens);
                await supabase.from('cost_tracking').insert({
                    service: 'claude',
                    operation: 'newsletter_draft',
                    topic_id: topicId,
                    cost_usd: costUsd,
                    tokens_input: inputTokens,
                    tokens_output: outputTokens,
                });

                draftsGenerated++;
            }
        } catch (e) {
            console.error(`Newsletter draft generation failed for topic ${topicId}:`, e);
        }
    }

    return draftsGenerated;
}

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();

        // Clean up expired workflow locks
        const staleLocksRemoved = await cleanStaleLocks();

        const heygenResult = await pollHeyGenStatuses(supabase);
        const blotatoVideoResult = await pollBlotatoVideoStatuses(supabase);
        const blotatoResult = await pollBlotatoStatuses(supabase);

        // Auto-generate newsletter drafts for newly published topics
        let newsletterDraftsGenerated = 0;
        if (blotatoResult.newlyPublishedTopicIds.length > 0) {
            newsletterDraftsGenerated = await generateNewsletterDrafts(
                supabase,
                blotatoResult.newlyPublishedTopicIds,
            );
        }

        const emptyHeyGen = { checked: 0, completed: 0, failed: 0, stillProcessing: 0 };
        const emptyBlotatoVideo = { checked: 0, completed: 0, failed: 0, stillProcessing: 0 };

        if (!heygenResult && !blotatoVideoResult && blotatoResult.checked === 0) {
            return NextResponse.json({
                success: true,
                message: 'No pending jobs',
                heygen: emptyHeyGen,
                blotatoVideo: emptyBlotatoVideo,
                blotato: blotatoResult,
                staleLocksRemoved,
                newsletterDraftsGenerated,
            });
        }

        return NextResponse.json({
            success: true,
            heygen: heygenResult ?? emptyHeyGen,
            blotatoVideo: blotatoVideoResult ?? emptyBlotatoVideo,
            blotato: blotatoResult,
            staleLocksRemoved,
            newsletterDraftsGenerated,
        });
    } catch (error) {
        console.error('Check-status cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
