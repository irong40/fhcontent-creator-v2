import { createClient } from '@supabase/supabase-js';

const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
    const { data: topics } = await sb
        .from('topics')
        .select('id, title, status, created_at')
        .eq('persona_id', '6ac9adfa-27f1-492b-98e1-f5623cb4eda2')
        .order('created_at', { ascending: false });

    console.log('Dr. Imani Carter topics:');
    for (const t of topics || []) {
        console.log(`  ${t.id.slice(0,8)} | ${t.status.padEnd(20)} | ${t.title}`);
        const { data: pieces } = await sb
            .from('content_pieces')
            .select('piece_type, status')
            .eq('topic_id', t.id);
        for (const p of pieces || []) {
            console.log(`    - ${p.piece_type.padEnd(15)} | ${p.status}`);
        }
    }
}

main();
