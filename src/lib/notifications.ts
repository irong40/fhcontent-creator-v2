/**
 * Error notification via n8n webhook.
 * Fire-and-forget — failures don't block the pipeline.
 */
let warnedMissingWebhook = false;

export async function notifyError(context: {
    source: string;
    message: string;
    topicId?: string;
    personaName?: string;
}): Promise<void> {
    const webhookUrl = process.env.N8N_ERROR_WEBHOOK_URL;
    if (!webhookUrl) {
        if (!warnedMissingWebhook) {
            console.warn('[notifications] N8N_ERROR_WEBHOOK_URL not set — error notifications will be silently dropped');
            warnedMissingWebhook = true;
        }
        return;
    }

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
        console.error('Failed to send error notification');
    }
}
