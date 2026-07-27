import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { publishTopicSchema } from '@/lib/schemas';
import { publishTopic } from '@/app/api/cron/daily-publish/route';
import { prepareManualPublish } from './prepare';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { force } = publishTopicSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch topic to verify status
        const { data: topic, error } = await supabase
            .from('topics')
            .select('id, title, status, publish_at, publish_date, published_at')
            .eq('id', id)
            .single();

        if (error || !topic) {
            return NextResponse.json(
                { success: false, error: 'Topic not found' },
                { status: 404 },
            );
        }

        // Verify eligible status (allow retry from failed/partially_published).
        //
        // 'published' is retryable ONLY with force. A topic settles 'published'
        // when every platform it submitted succeeded — which can be true while
        // a rendered, fully targeted piece never went out at all (the late
        // render / drained-24h-cap shape). 'published' is terminal for the cron
        // (not in selectPublishableTopics' status list), so before this the one
        // fully recoverable content gap in the system had no recovery path in
        // any cron, API or UI. publishTopic skips pieces whose platforms are all
        // published or pending, so a forced re-run can only ship what is
        // missing — it cannot re-post anything (2026-07-26 review).
        const allowedStatuses = force
            ? ['approved', 'scheduled', 'partially_published', 'failed', 'published']
            : ['scheduled', 'partially_published', 'failed'];

        if (!allowedStatuses.includes(topic.status)) {
            return NextResponse.json(
                {
                    success: false,
                    error: force
                        ? `Topic must be approved or scheduled to publish (current: ${topic.status})`
                        : `Topic must be scheduled to publish (current: ${topic.status}). Use force: true to publish approved topics.`,
                },
                { status: 400 },
            );
        }

        // Same workflow lock as the hourly cron. Without it, a manual publish
        // racing a cron tick double-reads the pre-submission platform state and
        // submits the same video twice (Codex review 2026-07-18, Major 2).
        const lockToken = await acquireLock('daily-publish');
        if (!lockToken) {
            return NextResponse.json(
                { success: false, error: 'A publish run is already in progress — retry in a minute' },
                { status: 409 },
            );
        }

        try {
            // Re-open the publish window and clear settlement condemnations
            // BEFORE publishing — see prepare.ts for why an operator retry that
            // does neither is unsafe (the settlement pass would treat the run as
            // already out of reach) or inert (the publisher skips condemned
            // pieces).
            const prepared = await prepareManualPublish(supabase, topic, new Date());
            const result = await publishTopic(id);
            return NextResponse.json({
                success: true,
                ...result,
                ...prepared,
                hasWarnings: result.warnings.length > 0,
            });
        } finally {
            await releaseLock('daily-publish', lockToken);
        }
    } catch (error) {
        console.error('Manual publish error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
