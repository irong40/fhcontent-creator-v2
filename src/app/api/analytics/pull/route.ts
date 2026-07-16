import { NextResponse } from 'next/server';
import { runAnalyticsPull } from '@/lib/analytics-pull';

/**
 * POST /api/analytics/pull — manual trigger from the dashboard.
 * Sits behind the app's auth middleware (unauthenticated requests are
 * redirected to /login). The scheduled path is GET /api/cron/analytics-pull.
 */

export const maxDuration = 300;

export async function POST() {
    const { status, body } = await runAnalyticsPull();
    return NextResponse.json(body, { status });
}
