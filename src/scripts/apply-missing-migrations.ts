import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Apply migration 004 - workflow_locks
    const sql = readFileSync(join(__dirname, '../../supabase/migrations/004_workflow_locks.sql'), 'utf-8');
    console.log('Applying migration 004_workflow_locks...');

    // Split by semicolons and execute each statement
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
        console.log(`  Executing: ${stmt.slice(0, 60)}...`);
        const { error } = await sb.rpc('exec_sql' as any, { query: stmt });
        if (error) {
            // Try raw SQL via pg
            console.log(`  RPC failed, trying direct: ${error.message}`);
        }
    }

    // Verify
    const { data, error } = await sb.from('workflow_locks').select('*');
    if (error) console.log('Table still missing:', error.message);
    else console.log('workflow_locks table created successfully, rows:', data.length);
}

main();
