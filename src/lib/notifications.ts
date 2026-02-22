/**
 * Error notification via n8n webhook + optional email via Resend.
 * Fire-and-forget — failures don't block the pipeline.
 */
import { sendErrorAlert } from '@/lib/email';

let warnedMissingWebhook = false;

export async function notifyError(context: {
    source: string;
    message: string;
    topicId?: string;
    personaName?: string;
}): Promise<void> {
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
                    environment: process.env.VERCEL_ENV || 'development',
                }),
            });
        } catch {
            console.error('Failed to send webhook notification');
        }
    } else if (!warnedMissingWebhook) {
        console.warn('[notifications] N8N_ERROR_WEBHOOK_URL not set — webhook notifications disabled');
        warnedMissingWebhook = true;
    }

    // Email via Resend (new)
    sendErrorAlert(context).catch(() => {
        // fire-and-forget
    });
}
