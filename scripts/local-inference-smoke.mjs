// Isolated SQL + actual Ollama smoke. No Supabase credentials or production mutations.
// Install @electric-sql/pglite in a disposable directory, then set PGLITE_PACKAGE_DIR.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import worker from './local-inference-worker.ts';
const { runOnce } = worker;

if (!process.env.PGLITE_PACKAGE_DIR) throw new Error('Set PGLITE_PACKAGE_DIR to isolated npm install directory');
const require = createRequire(join(process.env.PGLITE_PACKAGE_DIR, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const checks = [];
try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile('supabase/migrations/20260911201146_local_inference_jobs.sql', 'utf8'));
    checks.push('Migration executes in isolated PostgreSQL');
    const rights = await db.query("select has_table_privilege('anon','public.local_inference_jobs','SELECT') as anon, has_function_privilege('authenticated','public.claim_local_inference_job(text)','EXECUTE') as user_claim");
    assert.deepEqual(rights.rows[0], { anon: false, user_claim: false });
    checks.push('Anonymous table and authenticated claim privileges denied');
    const schema = { type: 'object', properties: { caption: { type: 'string' } }, required: ['caption'], additionalProperties: false };
    const inserted = await db.query('insert into public.local_inference_jobs(request_key,system_prompt,user_prompt,max_tokens,response_schema) values($1,$2,$3,$4,$5) returning id', [
        'f'.repeat(64), 'Write one short caption using only the supplied facts. Return JSON. This is a review draft.',
        'Synthetic test: SAI documents visible site conditions with aerial photographs. Photographs do not certify safety.', 200, JSON.stringify(schema),
    ]);
    const id = inserted.rows[0].id;
    const claim = await db.query('select * from public.claim_local_inference_job($1)', ['lease-fixture']);
    assert.equal(claim.rows.length, 1);
    const duplicate = await db.query('select * from public.claim_local_inference_job($1)', ['second-worker']);
    assert.equal(duplicate.rows.length, 0);
    const rejected = await db.query('select public.finish_local_inference_job($1,$2,$3,$4,$5,$6) as accepted', [id, randomUUID(), '{}', 1, 1, null]);
    assert.equal(rejected.rows[0].accepted, false);
    await db.query("update public.local_inference_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
    checks.push('An active lease cannot be claimed twice; wrong token cannot complete');
    const rpc = async (name, args) => {
        if (name === 'claim_local_inference_job') return JSON.parse(JSON.stringify((await db.query('select * from public.claim_local_inference_job($1)', [args.p_worker_id])).rows));
        if (name === 'finish_local_inference_job') return (await db.query('select public.finish_local_inference_job($1,$2,$3,$4,$5,$6) as accepted', [args.p_job_id, args.p_lease_token, args.p_text, args.p_input_tokens, args.p_output_tokens, args.p_error])).rows[0].accepted;
        throw new Error('Unexpected RPC');
    };
    const started = Date.now();
    assert.equal(await runOnce(rpc, 'live-local-smoke'), 'completed');
    const result = (await db.query('select status,model,result_text,input_tokens,output_tokens,attempts from public.local_inference_jobs where id=$1', [id])).rows[0];
    assert.equal(result.status, 'succeeded');
    assert.equal(result.attempts, 2);
    checks.push('Expired lease reclaimed; actual local Ollama output validated and completed');
    await db.query("insert into public.local_inference_jobs(request_key,system_prompt,user_prompt,max_tokens,status,attempts,lease_token,lease_expires_at) values($1,'fixture','fixture',1,'running',3,$2,now()-interval '1 second')", ['e'.repeat(64), randomUUID()]);
    await db.query('select * from public.claim_local_inference_job($1)', ['exhausted-test']);
    assert.equal((await db.query("select status from public.local_inference_jobs where request_key=$1", ['e'.repeat(64)])).rows[0].status, 'failed');
    checks.push('Third expired attempt becomes terminal failure');
    const report = { checkedAt: new Date().toISOString(), boundary: 'Isolated PGlite PostgreSQL and real loopback Ollama. No hosted Supabase transport, deployed route, or publishing was exercised.', checks, elapsedMs: Date.now() - started, result };
    await writeFile('docs/local-inference-smoke-2026-09-11.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await db.close(); }
