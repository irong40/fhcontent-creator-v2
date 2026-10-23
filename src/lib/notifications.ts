/**
 * Error notification via n8n webhook + Resend email + DB persistence.
 * Fire-and-forget — failures don't block the pipeline.
 *
 * DB persistence (errors table, migration 015) backs the in-app
 * notification bell and /admin/errors page. Email + webhook remain the
 * push channels.
 */
import { sendErrorAlert } from '@/lib/email';
import { createAdminClient } from '@/lib/supabase/server';
import { recordTrail, type AlertChannel, type ChannelOutcome } from '@/lib/judge-trail';

let warnedMissingWebhook = false;

export async function notifyError(context: {
    source: string;
    message: string;
    topicId?: string;
    personaName?: string;
    severity?: 'error' | 'warning' | 'info';
    /** HR-7: when set, each channel's own outcome is written to judge_trail under this id. */
    trail?: { correlationId: string; topicVersion: string; errorId?: string };
}): Promise<void> {
    const outcomes: Partial<Record<AlertChannel, ChannelOutcome>> = {};
    const environment = process.env.VERCEL_ENV || 'development';

    // n8n webhook (existing)
    const webhookUrl = process.env.N8N_ERROR_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...context,
                    timestamp: new Date().toISOString(),
                    environment,
                }),
            });
            outcomes.webhook = res.ok ? 'sent' : 'failed';
        } catch {
            outcomes.webhook = 'failed';
            console.error('Failed to send webhook notification');
        }
    } else {
        outcomes.webhook = 'skipped';
        if (!warnedMissingWebhook) {
            console.warn('[notifications] N8N_ERROR_WEBHOOK_URL not set — webhook notifications disabled');
            warnedMissingWebhook = true;
        }
    }

    // Email via Resend. sendErrorAlert returns false when NOTIFICATION_EMAIL is unset or Resend refused.
    // Unset NOTIFICATION_EMAIL is 'skipped' (nothing was attempted), not a failed delivery.
    outcomes.resend = process.env.NOTIFICATION_EMAIL
        ? await sendErrorAlert(context).then(ok => (ok ? 'sent' : 'failed'), () => 'failed' as const)
        : 'skipped';

    // DB persistence for in-app notification bell + admin page.
    // Fire-and-forget: a DB outage must not silence the email/webhook channels.
    // HR-7: the errors row id goes on each alert_channel row, so an acknowledgement joins THIS alert exactly.
    // When the escalation already picked the id (trail.errorId), the row is inserted under that id.
    let errorId: string | null = null;
    try {
        const supabase = createAdminClient();
        const { data: inserted, error: insertError } = await supabase.from('errors').insert({
            ...(context.trail?.errorId ? { id: context.trail.errorId } : {}),
            source: context.source,
            message: context.message,
            topic_id: context.topicId ?? null,
            persona_name: context.personaName ?? null,
            environment,
            severity: context.severity ?? 'error',
        }).select('id').maybeSingle();
        outcomes.db = insertError ? 'failed' : 'sent';
        errorId = (inserted as { id?: string } | null)?.id ?? null;
        if (insertError) console.error('[notifications] DB persist failed:', insertError.message);
    } catch (e) {
        outcomes.db = 'failed';
        console.error('[notifications] DB persist failed:', e instanceof Error ? e.message : e);
    }

    // HR-7: the record of which channel fired. Webhook silence proves nothing; these rows do.
    if (context.trail && context.topicId) {
        try {
            const supabase = createAdminClient();
            for (const [channel, outcome] of Object.entries(outcomes)) {
                await recordTrail(supabase, {
                    correlation_id: context.trail.correlationId, stage: 'alert_channel',
                    topic_id: context.topicId, topic_version: context.trail.topicVersion,
                    detail: { channel, outcome, source: context.source, ...(errorId ? { error_id: errorId } : {}) },
                });
            }
        } catch { /* trail is best effort */ }
    }
}
