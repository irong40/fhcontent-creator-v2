import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { recordTrail } from '@/lib/judge-trail';

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

    // HR-7: close the trail. The errors row has no correlation column, so take it from the newest
    // alert_channel row the same topic wrote. Best effort: never fails the acknowledge.
    if (acknowledged && data?.topic_id) {
        try {
            const admin = createAdminClient();
            const { data: last } = await admin.from('judge_trail' as never)
                .select('correlation_id, topic_version').eq('topic_id', data.topic_id).eq('stage', 'alert_channel')
                .order('at', { ascending: false }).limit(1).maybeSingle() as { data: { correlation_id: string; topic_version: string } | null };
            if (last?.correlation_id) {
                await recordTrail(admin, {
                    correlation_id: last.correlation_id, stage: 'acknowledged',
                    topic_id: data.topic_id, topic_version: last.topic_version,
                    detail: { error_id: id, acknowledged_by: user.id },
                });
            }
        } catch { /* trail is best effort */ }
    }

    return NextResponse.json({ error: data });
}
