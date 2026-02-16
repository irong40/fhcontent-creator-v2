/**
 * Shared CRON_SECRET validation for cron endpoints.
 *
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` to cron jobs.
 * In development (no CRON_SECRET set), requests are allowed through.
 */
export function validateCronSecret(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return true;
    const auth = request.headers.get('authorization');
    return auth === `Bearer ${secret}`;
}
