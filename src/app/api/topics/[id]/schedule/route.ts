import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { scheduleTopicSchema } from '@/lib/schemas';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { publishDate, publishTime } = scheduleTopicSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch topic
        const { data: topic, error: fetchError } = await supabase
            .from('topics')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !topic) {
            return NextResponse.json(
                { success: false, error: 'Topic not found' },
                { status: 404 },
            );
        }

        if (topic.status !== 'approved') {
            return NextResponse.json(
                { success: false, error: `Cannot schedule topic in "${topic.status}" status. Must be "approved".` },
                { status: 400 },
            );
        }

        // Validate date is today or future
        const today = new Date().toISOString().split('T')[0];
        if (publishDate < today) {
            return NextResponse.json(
                { success: false, error: 'Publish date must be today or in the future' },
                { status: 400 },
            );
        }

        // Schedule
        const { error: updateError } = await supabase
            .from('topics')
            .update({
                status: 'scheduled',
                publish_date: publishDate,
                publish_time: publishTime,
            })
            .eq('id', id);

        if (updateError) {
            return NextResponse.json(
                { success: false, error: updateError.message },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            status: 'scheduled',
            publishDate,
            publishTime,
        });
    } catch (error) {
        console.error('Topic schedule error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
