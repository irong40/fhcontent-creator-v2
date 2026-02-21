import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { publishTopicSchema } from '@/lib/schemas';
import { publishTopic } from '@/app/api/cron/daily-publish/route';

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
            .select('id, title, status')
            .eq('id', id)
            .single();

        if (error || !topic) {
            return NextResponse.json(
                { success: false, error: 'Topic not found' },
                { status: 404 },
            );
        }

        // Verify eligible status (allow retry from failed/partially_published)
        const allowedStatuses = force
            ? ['approved', 'scheduled', 'partially_published', 'failed']
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

        const result = await publishTopic(id);

        return NextResponse.json({
            success: true,
            ...result,
            hasWarnings: result.warnings.length > 0,
        });
    } catch (error) {
        console.error('Manual publish error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
