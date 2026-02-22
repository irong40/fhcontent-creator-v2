// Run V2 database migration via Supabase Management API
// Usage: npx tsx src/scripts/run-migration.ts

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF) {
    console.error('Missing SUPABASE_PROJECT_REF env var');
    process.exit(1);
}

if (!SUPABASE_ACCESS_TOKEN) {
    console.error('Missing SUPABASE_ACCESS_TOKEN env var (sbp_... personal access token)');
    process.exit(1);
}

async function runSQL(sql: string, label: string): Promise<boolean> {
    console.log(`\n--- ${label} ---`);
    const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ query: sql }),
        }
    );

    const text = await res.text();
    if (!res.ok) {
        console.log(`FAILED (${res.status}): ${text}`);
        return false;
    }
    console.log(`OK (${res.status})`);
    return true;
}

async function main() {
    console.log('Content Creator V2 - Database Migration');
    console.log('========================================');
    console.log(`Target project: ${PROJECT_REF}`);
    console.log('');

    // Step 1: Drop existing tables
    const dropSQL = `
DROP VIEW IF EXISTS cost_summary CASCADE;
DROP FUNCTION IF EXISTS get_lru_voice CASCADE;
DROP FUNCTION IF EXISTS check_duplicate_topic CASCADE;
DROP TABLE IF EXISTS cost_tracking CASCADE;
DROP TABLE IF EXISTS published_log CASCADE;
DROP TABLE IF EXISTS visual_assets CASCADE;
DROP TABLE IF EXISTS audio_assets CASCADE;
DROP TABLE IF EXISTS content_pieces CASCADE;
DROP TABLE IF EXISTS voices CASCADE;
DROP TABLE IF EXISTS topics CASCADE;
DROP TABLE IF EXISTS personas CASCADE;
`;

    const dropOk = await runSQL(dropSQL, 'Step 1: Drop existing tables');
    if (!dropOk) {
        console.log('\nDrop failed. Check if the Supabase access token is valid.');
        process.exit(1);
    }

    // Step 2: Run V2 schema
    const migrationPath = join(process.cwd(), 'supabase', 'migrations', '001_v2_schema.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    const createOk = await runSQL(migrationSQL, 'Step 2: Create V2 schema');
    if (!createOk) {
        console.log('\nSchema creation failed!');
        process.exit(1);
    }

    console.log('\n========================================');
    console.log('Migration complete!');
    console.log('Tables created: personas, topics, content_pieces, voices,');
    console.log('  audio_assets, visual_assets, published_log, cost_tracking');
    console.log('View created: cost_summary');
    console.log('Functions: get_lru_voice, check_duplicate_topic');
    console.log('RLS enabled on all tables');
}

main().catch(console.error);
