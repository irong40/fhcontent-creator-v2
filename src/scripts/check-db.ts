import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const tables = ['brands', 'personas', 'topics', 'content_pieces', 'voices', 'cost_tracking'];

    for (const table of tables) {
        const { data, error, count } = await sb.from(table).select('*', { count: 'exact', head: true });
        if (error) {
            console.log(`${table}: ERROR - ${error.message}`);
        } else {
            console.log(`${table}: ${count} rows`);
        }
    }

    // Get persona details
    const { data: personas } = await sb.from('personas').select('id,name,brand');
    console.log('\nPersonas:', JSON.stringify(personas, null, 2));
}

main();
