import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if table exists
    const { error } = await sb.from('workflow_locks').select('*').limit(1);
    if (!error) {
        console.log('workflow_locks table already exists');
        return;
    }

    console.log('Table missing:', error.message);
    console.log('\nYou need to run this SQL in the Supabase Dashboard SQL Editor:');
    console.log('URL: https://supabase.com/dashboard/project/qjpujskwqaehxnqypxzu/sql/new\n');
    console.log(`
CREATE TABLE workflow_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id TEXT NOT NULL UNIQUE,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_token UUID NOT NULL DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_workflow_locks_workflow ON workflow_locks(workflow_id);
CREATE INDEX idx_workflow_locks_expires ON workflow_locks(expires_at);

ALTER TABLE workflow_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to workflow_locks"
    ON workflow_locks FOR ALL USING (true) WITH CHECK (true);
`);
}

main();
