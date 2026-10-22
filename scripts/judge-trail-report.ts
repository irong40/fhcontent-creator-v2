import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { buildProgressReport, renderProgressReport, type TrailEvent } from '../src/lib/judge-trail';

/** Read-only: prints the topics that did not advance, from judge_trail rows. Sends no alert, calls no model. */
async function main() {
    const env = parse(await readFile('.env.local'));
    const hours = Number(process.argv[2] ?? 72);
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('Usage: npx tsx scripts/judge-trail-report.ts [hours=72]');
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.trim()}/rest/v1/judge_trail?at=gte.${encodeURIComponent(since)}&order=at.asc&limit=5000&select=correlation_id,stage,topic_id,topic_version,job_id,detail,at`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY.trim() }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`judge_trail read failed HTTP ${response.status} (is migration 20261022120000 applied?)`);
    console.log(renderProgressReport(buildProgressReport((await response.json()) as TrailEvent[], new Date())));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'report failed'); process.exitCode = 1; });
