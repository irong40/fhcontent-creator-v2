/**
 * Shared CRON_SECRET validation for cron endpoints.
 *
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` to cron jobs.
 *
 * Fail-closed in production: if CRON_SECRET is unset (e.g. a `vercel env rm`
 * without re-add, or a new environment missing the var), every cron endpoint
 * would otherwise become publicly invokable — anyone could trigger publishing,
 * burn paid Claude tokens via daily-topic/content-generator, or hammer Blotato
 * (review 2026-07-04). In local development (no CRON_SECRET set), requests are
 * still allowed through for manual testing.
 */
export function validateCronSecret(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('[cron] CRON_SECRET is not set in production — rejecting request (fail closed)');
            return false;
        }
        return true;
    }
    const auth = request.headers.get('authorization');
    return auth === `Bearer ${secret}`;
}
