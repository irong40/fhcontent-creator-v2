import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/errors
 * Query params:
 *   - acknowledged: 'true' | 'false' (default: returns both)
 *   - limit: number (default 50, max 200)
 *   - source: filter by source string
 *
 * Returns errors in newest-first order. RLS gates by authenticated user.
 */
export async function GET(request: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const acknowledgedParam = searchParams.get('acknowledged');
    const sourceParam = searchParams.get('source');
    const limitParam = Number(searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    let query = supabase
        .from('errors')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .limit(limit);

    if (acknowledgedParam === 'true') query = query.eq('acknowledged', true);
    if (acknowledgedParam === 'false') query = query.eq('acknowledged', false);
    if (sourceParam) query = query.eq('source', sourceParam);

    const { data, error, count } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ errors: data ?? [], total: count ?? 0 });
}
