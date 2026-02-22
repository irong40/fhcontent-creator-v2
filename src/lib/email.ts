/**
 * Email notification service via Resend.
 * Graceful fallback — logs and skips when RESEND_API_KEY not set.
 */

let warnedMissingKey = false;

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
}

async function sendEmail({ to, subject, html }: EmailOptions): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        if (!warnedMissingKey) {
            console.warn('[email] RESEND_API_KEY not set — email notifications disabled');
            warnedMissingKey = true;
        }
        return false;
    }

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                from: process.env.RESEND_FROM_EMAIL || 'Content Command Center <noreply@faithharmony.com>',
                to,
                subject,
                html,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[email] Resend API error (${response.status}): ${errorText}`);
            return false;
        }

        return true;
    } catch (error) {
        console.error('[email] Failed to send:', error);
        return false;
    }
}

export async function sendErrorAlert(context: {
    source: string;
    message: string;
    topicId?: string;
    personaName?: string;
}): Promise<boolean> {
    const to = process.env.NOTIFICATION_EMAIL;
    if (!to) return false;

    return sendEmail({
        to,
        subject: `[CCC Error] ${context.source}: ${context.message.slice(0, 60)}`,
        html: `
            <h2>Content Command Center — Error Alert</h2>
            <p><strong>Source:</strong> ${context.source}</p>
            <p><strong>Message:</strong> ${context.message}</p>
            ${context.topicId ? `<p><strong>Topic:</strong> ${context.topicId}</p>` : ''}
            ${context.personaName ? `<p><strong>Persona:</strong> ${context.personaName}</p>` : ''}
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
            <p><strong>Environment:</strong> ${process.env.VERCEL_ENV || 'development'}</p>
        `,
    });
}

export async function sendPublishSuccess(context: {
    topicTitle: string;
    platformResults: Record<string, string>;
    totalPieces: number;
}): Promise<boolean> {
    const to = process.env.NOTIFICATION_EMAIL;
    if (!to) return false;

    const platformRows = Object.entries(context.platformResults)
        .map(([platform, status]) => `<tr><td>${platform}</td><td>${status}</td></tr>`)
        .join('');

    return sendEmail({
        to,
        subject: `[CCC] Published: ${context.topicTitle}`,
        html: `
            <h2>Content Published Successfully</h2>
            <p><strong>Topic:</strong> ${context.topicTitle}</p>
            <p><strong>Pieces:</strong> ${context.totalPieces}</p>
            <table border="1" cellpadding="6" cellspacing="0">
                <tr><th>Platform</th><th>Status</th></tr>
                ${platformRows}
            </table>
            <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        `,
    });
}

export async function sendDailyDigest(context: {
    date: string;
    topicsPublished: number;
    topicsFailed: number;
    totalCostUsd: number;
    errors: string[];
}): Promise<boolean> {
    const to = process.env.NOTIFICATION_EMAIL;
    if (!to) return false;

    const errorList = context.errors.length > 0
        ? `<h3>Errors</h3><ul>${context.errors.map(e => `<li>${e}</li>`).join('')}</ul>`
        : '<p>No errors today.</p>';

    return sendEmail({
        to,
        subject: `[CCC Daily Digest] ${context.date} — ${context.topicsPublished} published, $${context.totalCostUsd.toFixed(2)} spent`,
        html: `
            <h2>Daily Digest — ${context.date}</h2>
            <table border="1" cellpadding="6" cellspacing="0">
                <tr><td>Topics Published</td><td>${context.topicsPublished}</td></tr>
                <tr><td>Topics Failed</td><td>${context.topicsFailed}</td></tr>
                <tr><td>Total Cost</td><td>$${context.totalCostUsd.toFixed(2)}</td></tr>
            </table>
            ${errorList}
        `,
    });
}
