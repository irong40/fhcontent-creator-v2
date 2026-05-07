import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const topicId = '568b9441-dae3-4424-8d0d-279baddf9881'; // Mary Bowser

    // Topic was already approved. Now schedule for today.
    const today = new Date().toISOString().split('T')[0];
    console.log('=== Scheduling for today:', today, '===');

    const { error: schedErr } = await sb.from('topics').update({
        status: 'scheduled',
        publish_date: today,
        publish_time: '12:00',
    }).eq('id', topicId);

    if (schedErr) { console.error('Schedule error:', schedErr.message); return; }
    console.log('Topic scheduled');

    // Trigger the publish cron
    console.log('=== Triggering daily-publish cron ===');
    const cronSecret = process.env.CRON_SECRET;
    try {
        const resp = await fetch('http://localhost:3001/api/cron/daily-publish', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${cronSecret}`,
            },
        });
        const result = await resp.json();
        console.log(`Response (${resp.status}):`, JSON.stringify(result, null, 2));
    } catch (e: any) {
        console.error('Fetch error:', e.message);
    }

    // Check final status
    const { data: topic } = await sb.from('topics').select('id,title,status,published_at,error_message').eq('id', topicId).single();
    console.log('\nFinal status:', JSON.stringify(topic, null, 2));
}

main();
