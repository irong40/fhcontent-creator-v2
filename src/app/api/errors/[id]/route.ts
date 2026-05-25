import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/errors/[id]
 * Body: { acknowledged: boolean }
 *
 * Toggle the acknowledged flag on a single error. Sets acknowledged_at
 * and acknowledged_by when transitioning to true; clears both on false.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const acknowledged = Boolean(body.acknowledged);

    const update = acknowledged
        ? { acknowledged: true, acknowledged_at: new Date().toISOString(), acknowledged_by: user.id }
        : { acknowledged: false, acknowledged_at: null, acknowledged_by: null };

    const { data, error } = await supabase
        .from('errors')
        .update(update)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: data });
}
