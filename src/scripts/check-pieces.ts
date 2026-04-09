import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await sb.from('content_pieces').select('id,topic_id,piece_type,status');
    if (error) { console.log('Error:', error.message); return; }

    console.log(`Total pieces: ${data.length}`);
    for (const p of data) {
        console.log(`${String(p.topic_id).slice(0,8)} | ${String(p.piece_type).padEnd(15)} | ${String(p.status).padEnd(12)}`);
    }

    // Also check the topic with content_ready
    const topicId = '568b9441-beff-4d44-a08b-ff3e22b68a87'; // approx
    const { data: topics } = await sb.from('topics').select('id,title,status').eq('status', 'content_ready');
    console.log('\nContent-ready topics:');
    for (const t of topics || []) {
        console.log(`  ${t.id} | ${t.title}`);
        const { data: tp } = await sb.from('content_pieces').select('piece_type,status').eq('topic_id', t.id);
        console.log(`  Pieces: ${JSON.stringify(tp)}`);
    }
}

main();
