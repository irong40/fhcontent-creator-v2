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

let warnedMissingWebhook = false;

export async function notifyError(context: {
    source: string;
    message: string;
    topicId?: string;
    personaName?: string;
    severity?: 'error' | 'warning' | 'info';
}): Promise<void> {
    const environment = process.env.VERCEL_ENV || 'development';

    // n8n webhook (existing)
    const webhookUrl = process.env.N8N_ERROR_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...context,
                    timestamp: new Date().toISOString(),
                    environment,
                }),
            });
        } catch {
            console.error('Failed to send webhook notification');
        }
    } else if (!warnedMissingWebhook) {
        console.warn('[notifications] N8N_ERROR_WEBHOOK_URL not set — webhook notifications disabled');
        warnedMissingWebhook = true;
    }

    // Email via Resend
    sendErrorAlert(context).catch(() => {
        // fire-and-forget
    });

    // DB persistence for in-app notification bell + admin page.
    // Fire-and-forget: a DB outage must not silence the email/webhook channels.
    try {
        const supabase = createAdminClient();
        await supabase.from('errors').insert({
            source: context.source,
            message: context.message,
            topic_id: context.topicId ?? null,
            persona_name: context.personaName ?? null,
            environment,
            severity: context.severity ?? 'error',
        });
    } catch (e) {
        console.error('[notifications] DB persist failed:', e instanceof Error ? e.message : e);
    }
}
