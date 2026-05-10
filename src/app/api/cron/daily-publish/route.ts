import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato, buildTarget, type Platform } from '@/lib/blotato';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { fillEvergreenGaps } from '@/lib/evergreen';
import { validateCronSecret } from '../middleware';
import { getConfiguredTargetPlatforms, getMediaUrl, getCarouselUrls, isTextOnlyPlatform, truncateTikTokTitle, capInstagramHashtags } from './helpers';
import type { TopicWithPersona, ContentPiece, PlatformAccounts, PlatformStatus, PublishedPlatforms } from '@/types/database';

export const maxDuration = 300;

interface PlatformResult {
    status: 'pending' | 'failed';
    postId?: string;
    error?: string;
}

interface PublishResult {
    topicId: string;
    title: string;
    piecesProcessed: number;
    platformResults: Record<string, PlatformResult>;
    warnings: string[];
}

async function publishPieceToPlatform(
    piece: ContentPiece,
    platform: Platform,
    accountId: string,
    topicTitle: string,
    mediaUrl: string,
): Promise<{ platformStatus: PlatformStatus; result: PlatformResult }> {
    // For carousel pieces on Instagram, upload all slides
    const mediaUrls: string[] = [];
    if (piece.piece_type === 'carousel') {
        const carouselSlideUrls = getCarouselUrls(piece);
        for (const slideUrl of carouselSlideUrls) {
            const upload = await blotato.uploadMedia(slideUrl);
            mediaUrls.push(upload.url);
        }
    } else {
        const uploadUrl = (isTextOnlyPlatform(platform) && piece.thumbnail_url)
            ? piece.thumbnail_url
            : mediaUrl;
        const upload = await blotato.uploadMedia(uploadUrl);
        mediaUrls.push(upload.url);
    }

    // Choose caption
    let caption = isTextOnlyPlatform(platform)
        ? (piece.caption_short || piece.caption_long || '')
        : (piece.caption_long || piece.caption_short || '');

    // Platform-specific sanitization
    if (platform === 'instagram') {
        caption = capInstagramHashtags(caption);
    }
    const platformTitle = platform === 'tiktok' ? truncateTikTokTitle(topicTitle) : topicTitle;

    const target = buildTarget(platform, { title: platformTitle, isAiGenerated: true });

    const response = await blotato.publishPost({
        post: {
            accountId,
            content: { text: caption, mediaUrls, platform },
            target,
        },
    });

    return {
        platformStatus: { status: 'pending', post_id: response.postSubmissionId },
        result: { status: 'pending', postId: response.postSubmissionId },
    };
}

export async function publishTopic(
    topicId: string,
): Promise<PublishResult> {
    const supabase = createAdminClient();

    // Fetch topic with persona
    const { data: topicData, error: topicError } = await supabase
        .from('topics')
        .select('*, personas(*)')
        .eq('id', topicId)
        .single();

    if (topicError || !topicData) {
        throw new Error(`Topic not found: ${topicId}`);
    }

    const topic = topicData as unknown as TopicWithPersona;
    const persona = topic.personas;
    const accounts = persona.platform_accounts as PlatformAccounts;

    const { data: pieces } = await supabase
        .from('content_pieces')
        .select('*')
        .eq('topic_id', topicId)
        .order('piece_order');

    if (!pieces || pieces.length === 0) {
        // Topic exists but media generation never ran — mark failed to stop hourly retries.
        // Not a transient error, so don't send an alert email.
        await supabase
            .from('topics')
            .update({ status: 'failed', error_message: 'No content pieces — media generation may not have run' })
            .eq('id', topicId);
        console.warn(`[daily-publish] Topic ${topicId} ("${topic.title}") has no content pieces — marked failed, skipping`);
        return { topicId, title: topic.title, piecesProcessed: 0, platformResults: {}, warnings: ['No content pieces — marked failed'] };
    }

    await supabase
        .from('topics')
        .update({ status: 'publishing' })
        .eq('id', topicId);

    const result: PublishResult = {
        topicId,
        title: topic.title,
        piecesProcessed: 0,
        platformResults: {},
        warnings: [],
    };

    let anySuccess = false;

    for (const piece of pieces as ContentPiece[]) {
        const mediaUrl = getMediaUrl(piece);
        if (!mediaUrl) {
            const warning = `${piece.piece_type}: no media URL — skipped`;
            result.warnings.push(warning);
            console.warn(`Piece ${piece.id} (${piece.piece_type}) has no media URL, skipping`);
            continue;
        }

        const existingPlatforms = (piece.published_platforms || {}) as PublishedPlatforms;
        const targetPlatforms = getConfiguredTargetPlatforms(piece.piece_type, accounts);
        const updatedPlatforms = { ...existingPlatforms } as Record<string, PlatformStatus>;

        for (const platform of targetPlatforms) {
            const existing = existingPlatforms[platform as keyof PublishedPlatforms];
            if (existing && existing.status !== 'failed') continue;

            const accountId = accounts[platform as keyof PlatformAccounts];
            if (!accountId) {
                const warning = `${piece.piece_type}: no ${platform} account configured — skipped`;
                result.warnings.push(warning);
                updatedPlatforms[platform] = { status: 'failed', error: 'No account configured' };
                continue;
            }

            const key = `${piece.piece_type}:${platform}`;

            try {
                const { platformStatus, result: platformResult } =
                    await publishPieceToPlatform(piece, platform, accountId, topic.title, mediaUrl);
                updatedPlatforms[platform] = platformStatus;
                result.platformResults[key] = platformResult;
                anySuccess = true;
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : 'Unknown error';
                console.error(`Failed to publish piece ${piece.id} to ${platform}:`, errorMsg);
                updatedPlatforms[platform] = { status: 'failed', error: errorMsg };
                result.platformResults[key] = { status: 'failed', error: errorMsg };
            }

            // Light per-platform throttle. Blotato cascades upload+publish to
            // each network and we've seen 25+ back-to-back calls in a single
            // topic. 300ms between pushes is invisible to the user but keeps
            // us off Blotato rate-limit errors.
            await new Promise((r) => setTimeout(r, 300));
        }

        await supabase
            .from('content_pieces')
            .update({
                published_platforms: updatedPlatforms as unknown as Record<string, unknown>,
                status: 'publishing',
            })
            .eq('id', piece.id);

        result.piecesProcessed++;
    }

    if (!anySuccess) {
        // If every piece was skipped because media isn't ready yet, leave as scheduled
        // so the next hourly run can retry. Don't mark failed and don't alert.
        if (result.piecesProcessed === 0) {
            await supabase
                .from('topics')
                .update({ status: 'scheduled' })
                .eq('id', topicId);
            console.warn(`[daily-publish] Topic ${topicId} ("${topic.title}") media not ready — left scheduled for retry`);
            return result;
        }
        await supabase
            .from('topics')
            .update({ status: 'failed', error_message: 'All platform publishes failed' })
            .eq('id', topicId);
        await notifyError({
            source: 'publishTopic',
            message: 'All platform publishes failed',
            topicId,
            personaName: persona.name,
        });
        return result;
    }

    await supabase.from('published_log').insert({
        persona_id: persona.id,
        topic_id: topicId,
        topic_title: topic.title,
        topic_hash: topic.topic_hash,
        published_at: new Date().toISOString(),
    });

    // Notify if there were warnings (missing accounts, missing media)
    if (result.warnings.length > 0) {
        await notifyError({
            source: 'publishTopic',
            message: `Publishing warnings: ${result.warnings.join('; ')}`,
            topicId,
            personaName: persona.name,
        });
    }

    // Status promotion is handled by check-status cron after Blotato confirms delivery
    return result;
}

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lockToken = await acquireLock('daily-publish');
    if (!lockToken) {
        return NextResponse.json(
            { success: false, error: 'Workflow already running' },
            { status: 409 },
        );
    }

    try {
        const supabase = createAdminClient();
        const nowIso = new Date().toISOString();
        const today = nowIso.split('T')[0];

        // Find topics ready to ship. Filtering rules:
        //  - scheduled/approved: pick up if publish_at <= now() (intra-day
        //    staggering). Falls back to publish_date <= today for legacy
        //    rows without publish_at set.
        //  - partially_published: retry to drain frozen platform failures
        //    (per-platform retry skip at line ~144 gates on status='failed',
        //    so re-running fully-resolved pieces is a no-op). Capped to 7
        //    days post-publish so we don't hammer Blotato forever on a
        //    permanently-broken caption.
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: topicsRaw, error } = await supabase
            .from('topics')
            .select('id, title, status, publish_at, publish_date, published_at')
            .in('status', ['scheduled', 'approved', 'partially_published'])
            .not('publish_date', 'is', null)
            .lte('publish_date', today);

        const topics = (topicsRaw ?? []).filter((t) => {
            if (t.status === 'partially_published') {
                return Boolean(t.published_at && t.published_at > sevenDaysAgo);
            }
            // scheduled / approved: enforce publish_at if present
            if (t.publish_at) return t.publish_at <= nowIso;
            return true; // legacy row, fall through publish_date check
        });

        if (error) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 500 },
            );
        }

        // If no topics scheduled, try evergreen fallback
        let publishableTopics = topics ?? [];
        let evergreenFills: Awaited<ReturnType<typeof fillEvergreenGaps>> = [];

        if (publishableTopics.length === 0) {
            evergreenFills = await fillEvergreenGaps(today);
            const scheduled = evergreenFills.filter(e => e.action === 'scheduled');

            if (scheduled.length === 0) {
                return NextResponse.json({
                    success: true,
                    message: 'No scheduled topics and no evergreen content available',
                    processed: 0,
                    evergreen: evergreenFills,
                });
            }

            // Re-query now that evergreen topics have been scheduled
            const { data: refetched } = await supabase
                .from('topics')
                .select('id, title, status, publish_at, publish_date, published_at')
                .eq('status', 'scheduled')
                .lte('publish_date', today);

            publishableTopics = refetched ?? [];
        }

        const results: PublishResult[] = [];
        const errors: string[] = [];

        for (const topic of publishableTopics) {
            try {
                const result = await publishTopic(topic.id);
                results.push(result);
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Unknown error';
                console.error(`Failed to publish topic ${topic.id}:`, msg);
                errors.push(`${topic.title}: ${msg}`);
                await notifyError({
                    source: 'daily-publish',
                    message: `Failed to publish topic: ${msg}`,
                    topicId: topic.id,
                });
            }
        }

        return NextResponse.json({
            success: true,
            processed: results.length,
            results,
            errors: errors.length > 0 ? errors : undefined,
            evergreen: evergreenFills.length > 0 ? evergreenFills : undefined,
        });
    } catch (error) {
        console.error('Daily-publish cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    } finally {
        await releaseLock('daily-publish', lockToken);
    }
}
