import { NextResponse } from 'next/server';
import { validateCronSecret } from '@/app/api/cron/middleware';
import { runAnalyticsPull } from '@/lib/analytics-pull';

/**
 * GET /api/cron/analytics-pull — daily Vercel cron (see vercel.json).
 * Lives under /api/cron so the auth middleware lets it through; cron
 * requests authenticate with the Bearer CRON_SECRET header like every
 * other cron route.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { status, body } = await runAnalyticsPull();
    return NextResponse.json(body, { status });
}
