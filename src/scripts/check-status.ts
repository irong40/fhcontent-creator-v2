import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get brands
    const { data: brands } = await sb.from('brands').select('*');
    console.log('=== BRANDS ===');
    for (const b of brands || []) {
        console.log(`  ${JSON.stringify(b)}`);
    }

    // Get topics with status
    const { data: topics } = await sb.from('topics').select('id,title,status,persona_id,created_at').order('created_at', { ascending: false });
    console.log('\n=== TOPICS ===');
    for (const t of topics || []) {
        console.log(`  ${String(t.id).slice(0,8)} | ${String(t.status).padEnd(12)} | ${t.title}`);
    }

    // Get content pieces
    const { data: pieces } = await sb.from('content_pieces').select('id,topic_id,piece_type,status,title').order('created_at', { ascending: false });
    console.log('\n=== CONTENT PIECES ===');
    for (const p of pieces || []) {
        console.log(`  ${String(p.id).slice(0,8)} | ${String(p.status).padEnd(12)} | ${String(p.piece_type).padEnd(15)} | ${String(p.title || 'untitled').slice(0,50)}`);
    }

    // Delete the duplicate persona we just created
    const { error: delErr } = await sb.from('personas').delete().eq('id', '4db2baf3-ae13-4a84-ae2b-edfe3ce6499b');
    if (delErr) console.log('\nCleanup error:', delErr.message);
    else console.log('\nCleaned up duplicate persona');
}

main();
