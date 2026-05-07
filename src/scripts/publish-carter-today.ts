import { createClient } from '@supabase/supabase-js';

const TOPIC_ID = 'a7fe80ab-fd1a-4f6d-a62b-12daf4375bf9';
const BASE_URL = 'https://fhcontent-creator-v2-bt3xbj9rd-faith-harmony.vercel.app';
const CRON_SECRET = process.env.CRON_SECRET!;

const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function step(label: string, fn: () => Promise<void>) {
    console.log(`\n=== ${label} ===`);
    try {
        await fn();
        console.log(`✓ Done`);
    } catch (e: any) {
        console.error(`✗ Failed: ${e.message}`);
        process.exit(1);
    }
}

async function main() {
    // Step 1: Generate content pieces (scripts + captions)
    await step('Generate content pieces', async () => {
        const res = await fetch(`${BASE_URL}/api/content/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topicId: TOPIC_ID }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
        console.log(`  Created ${json.pieces?.length ?? '?'} pieces`);
    });

    // Step 2: Kick off media generation (audio + video + thumbnails)
    await step('Kick off media generation', async () => {
        const res = await fetch(`${BASE_URL}/api/cron/daily-media`, {
            headers: { Authorization: `Bearer ${CRON_SECRET}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        console.log(`  Processed: ${json.processed}, results:`, JSON.stringify(json.results?.map((r: any) => ({
            title: r.title?.slice(0, 40),
            audioGenerated: r.audioGenerated,
            videoSubmitted: r.videoSubmitted,
            blotatoSubmitted: r.blotatoSubmitted,
            errors: r.errors,
        })), null, 2));
    });

    // Step 3: Approve + schedule for today
    await step('Approve and schedule for today', async () => {
        const today = new Date().toISOString().split('T')[0];

        const { error } = await sb.from('topics').update({
            status: 'scheduled',
            approved_at: new Date().toISOString(),
            publish_date: today,
            publish_time: '12:00',
        }).eq('id', TOPIC_ID);

        if (error) throw new Error(error.message);
        console.log(`  Scheduled for ${today}`);
    });

    console.log('\n=== Pipeline kicked off ===');
    console.log('Media jobs are now rendering (HeyGen + Blotato).');
    console.log('check-status cron runs every 10 min and will mark pieces ready.');
    console.log('daily-publish cron runs hourly and will publish once media is ready.');
    console.log('\nCheck status with: npx tsx --env-file=.env.local src/scripts/check-pieces.ts');
}

main();
