import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { sendCooPublishReport } from '@/lib/coo-report';
import { validateCronSecret } from '../middleware';

export const maxDuration = 60;

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();
        const sent = await sendCooPublishReport(supabase);

        return NextResponse.json({
            success: true,
            emailSent: sent,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('COO report cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
