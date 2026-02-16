import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { approveTopicSchema } from '@/lib/schemas';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        approveTopicSchema.parse(body);

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

        if (topic.status !== 'content_ready') {
            return NextResponse.json(
                { success: false, error: `Cannot approve topic in "${topic.status}" status. Must be "content_ready".` },
                { status: 400 },
            );
        }

        // Verify all pieces are ready or produced
        const { data: pieces } = await supabase
            .from('content_pieces')
            .select('id, piece_type, status')
            .eq('topic_id', id);

        if (!pieces || pieces.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No content pieces found for this topic' },
                { status: 400 },
            );
        }

        const notReady = pieces.filter(p => p.status !== 'ready' && p.status !== 'produced');
        if (notReady.length > 0) {
            return NextResponse.json(
                { success: false, error: `${notReady.length} piece(s) not ready: ${notReady.map(p => p.piece_type).join(', ')}` },
                { status: 400 },
            );
        }

        // Approve
        const { error: updateError } = await supabase
            .from('topics')
            .update({
                status: 'approved',
                approved_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (updateError) {
            return NextResponse.json(
                { success: false, error: updateError.message },
                { status: 500 },
            );
        }

        return NextResponse.json({ success: true, status: 'approved' });
    } catch (error) {
        console.error('Topic approve error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
