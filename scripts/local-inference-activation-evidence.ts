import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import assert from 'node:assert/strict';
const topicId='30c125e8-26fa-4f7c-953a-2556311e9e32';
async function main(){
    const env=parse(await readFile('.env.local'));
    async function rows(path:string){
        const response=await fetch(env.NEXT_PUBLIC_SUPABASE_URL.trim()+'/rest/v1/'+path,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY.trim()},signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error(`Verification HTTP ${response.status}`);
        return response.json();
    }
    const topic=(await rows(`topics?id=eq.${topicId}&select=id,status,requires_review,coo_auto_approved_at,approved_at,publish_date,retry_count`))[0];
    const pieces=await rows(`content_pieces?topic_id=eq.${topicId}&select=id,piece_type,status`);
    const costs=await rows(`cost_tracking?topic_id=eq.${topicId}&select=service,operation,cost_usd,tokens_input,tokens_output`);
    const job=(await rows('local_inference_jobs?id=eq.4116e946-186e-4454-892b-dbc58f9ff147&select=id,status,model,attempts,input_tokens,output_tokens,lease_token,created_at,updated_at'))[0];
    assert.equal(topic.status,'content_ready');assert.equal(topic.requires_review,true);assert.equal(topic.coo_auto_approved_at,null);assert.equal(topic.approved_at,null);
    assert.equal(pieces.length,6);assert.equal(new Set(pieces.map((p:{piece_type:string})=>p.piece_type)).size,6);
    assert.ok(pieces.every((p:{status:string})=>p.status==='pending'));
    assert.equal(costs.length,1);assert.equal(costs[0].service,'ollama');assert.equal(Number(costs[0].cost_usd),0);
    assert.equal(job.status,'succeeded');assert.equal(job.lease_token,null);
    const report={checkedAt:new Date().toISOString(),deployment:'https://fhcontent-creator-v2-87js7b128-faith-harmony.vercel.app',provider:'ollama',boundary:'Live deployed cron -> hosted Supabase queue -> hidden Windows worker -> local Ollama -> deployed cron -> six pending pieces and human-review hold. Internal future-dated test topic, subsequently removed. No media or publishing triggered.',topic,pieces,costs,job};
    await writeFile('docs/ollama-activation-evidence-2026-09-11.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
