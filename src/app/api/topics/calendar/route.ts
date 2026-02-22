import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const month = searchParams.get('month'); // e.g. "2026-02"
        const personaId = searchParams.get('persona');

        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return NextResponse.json(
                { success: false, error: 'month param required (YYYY-MM format)' },
                { status: 400 },
            );
        }

        // Build date range for the month
        const [year, mon] = month.split('-').map(Number);
        const startDate = `${month}-01`;
        const endDate = new Date(year, mon, 0).toISOString().split('T')[0]; // last day

        const supabase = createAdminClient();

        let query = supabase
            .from('topics')
            .select('id, title, status, publish_date, publish_time, persona_id, created_at')
            .gte('publish_date', startDate)
            .lte('publish_date', endDate)
            .order('publish_date', { ascending: true });

        if (personaId) {
            query = query.eq('persona_id', personaId);
        }

        const { data: topics, error } = await query;

        if (error) {
            return NextResponse.json(
                { success: false, error: error.message },
                { status: 500 },
            );
        }

        // Get piece counts per topic
        const topicIds = (topics || []).map(t => t.id);
        let pieceCounts: Record<string, number> = {};

        if (topicIds.length > 0) {
            const { data: pieces } = await supabase
                .from('content_pieces')
                .select('topic_id')
                .in('topic_id', topicIds);

            if (pieces) {
                pieceCounts = pieces.reduce((acc, p) => {
                    acc[p.topic_id] = (acc[p.topic_id] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
            }
        }

        const enriched = (topics || []).map(t => ({
            ...t,
            piece_count: pieceCounts[t.id] || 0,
        }));

        return NextResponse.json({ success: true, topics: enriched });
    } catch (error) {
        console.error('Calendar topics error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
