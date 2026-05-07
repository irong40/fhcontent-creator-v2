import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Clear stale workflow locks
    console.log('=== Clearing workflow locks ===');
    const { data: locks, error: lockErr } = await sb.from('workflow_locks').select('*');
    console.log('Current locks:', JSON.stringify(locks));

    if (locks && locks.length > 0) {
        const { error: delErr } = await sb.from('workflow_locks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (delErr) console.error('Delete error:', delErr.message);
        else console.log('Locks cleared');
    }

    // Retry publish
    console.log('\n=== Triggering daily-publish cron ===');
    const cronSecret = process.env.CRON_SECRET;
    const resp = await fetch('http://localhost:3001/api/cron/daily-publish', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cronSecret}` },
    });
    const result = await resp.json();
    console.log(`Response (${resp.status}):`, JSON.stringify(result, null, 2));

    // Wait a moment and check status
    await new Promise(r => setTimeout(r, 3000));
    const { data: topic } = await sb.from('topics')
        .select('id,title,status,published_at,error_message')
        .eq('id', '568b9441-dae3-4424-8d0d-279baddf9881')
        .single();
    console.log('\nFinal status:', JSON.stringify(topic, null, 2));
}

main();
