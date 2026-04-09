import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const topicId = '568b9441-dae3-4424-8d0d-279baddf9881'; // Mary Bowser topic

    // Step 1: Approve
    console.log('=== Approving topic ===');
    const { error: approveErr } = await sb.from('topics').update({
        status: 'approved',
        approved_at: new Date().toISOString(),
    }).eq('id', topicId);

    if (approveErr) { console.error('Approve error:', approveErr.message); return; }
    console.log('Topic approved');

    // Step 2: Schedule (set to publish now)
    console.log('=== Scheduling topic ===');
    const { error: schedErr } = await sb.from('topics').update({
        status: 'scheduled',
        scheduled_for: new Date().toISOString(),
    }).eq('id', topicId);

    if (schedErr) { console.error('Schedule error:', schedErr.message); return; }
    console.log('Topic scheduled for immediate publish');

    // Step 3: Trigger publish via the cron endpoint (no auth required)
    console.log('=== Triggering publish via cron ===');
    const cronSecret = process.env.CRON_SECRET;
    const resp = await fetch('http://localhost:3001/api/cron/daily-publish', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${cronSecret}`,
        },
    });

    const result = await resp.text();
    console.log(`Publish response (${resp.status}):`, result);
}

main();
