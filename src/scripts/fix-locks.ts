import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check all locks
    const { data: locks, error } = await sb.from('workflow_locks').select('*');
    if (error) {
        console.log('Lock table error:', error.message);
        return;
    }
    console.log('Locks found:', locks.length);
    for (const l of locks) {
        console.log(JSON.stringify(l));
    }

    // Delete ALL locks
    if (locks.length > 0) {
        for (const l of locks) {
            const { error: delErr } = await sb.from('workflow_locks').delete().eq('workflow_id', l.workflow_id);
            if (delErr) console.log('Delete error:', delErr.message);
            else console.log(`Deleted lock: ${l.workflow_id}`);
        }
    }

    // Also delete by expired
    await sb.from('workflow_locks').delete().lt('expires_at', new Date().toISOString());
    console.log('Expired locks cleaned');

    // Verify
    const { data: remaining } = await sb.from('workflow_locks').select('*');
    console.log('Remaining locks:', remaining?.length);
}

main();
