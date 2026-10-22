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

    // HR-7: close (or reopen) the trail. Join only the alert_channel row that recorded THIS error's id
    // (notifyError writes detail.error_id). No such row = identity unknown = no trail row: never
    // guess from the newest alert on the topic. The newest acknowledged-stage row for this error id
    // is its state: acknowledge writes a row only when that state is not already acknowledged, and
    // un-acknowledge writes a revoked:true row (the report reads it as open again), so a repeat of
    // the same click writes nothing. Best effort: never fails the acknowledge.
    if (data?.topic_id) {
        try {
            const admin = createAdminClient();
            const { data: own } = await admin.from('judge_trail' as never)
                .select('correlation_id, topic_id, topic_version').eq('stage', 'alert_channel').eq('detail->>error_id', id)
                .limit(1).maybeSingle() as { data: { correlation_id: string; topic_id: string; topic_version: string } | null };
            if (own?.correlation_id && own.topic_id === data.topic_id) {
                const { data: latest, error: readError } = await admin.from('judge_trail' as never)
                    .select('detail').eq('stage', 'acknowledged').eq('detail->>error_id', id)
                    .order('at', { ascending: false }).limit(1).maybeSingle() as { data: { detail?: { revoked?: boolean } } | null; error: unknown };
                const open = !latest || latest.detail?.revoked === true;
                if (!readError && acknowledged === open) {
                    await recordTrail(admin, {
                        correlation_id: own.correlation_id, stage: 'acknowledged',
                        topic_id: own.topic_id, topic_version: own.topic_version,
                        detail: acknowledged ? { error_id: id, acknowledged_by: user.id } : { error_id: id, revoked: true, revoked_by: user.id },
                    });
                }
            }
        } catch { /* trail is best effort */ }
    }

    return NextResponse.json({ error: data });
}
