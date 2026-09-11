import { randomUUID } from 'node:crypto';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

const MODEL = 'qwen3:8b';
const jobSchema = z.object({
  id: z.string().uuid(), lease_token: z.string().uuid(), lease_expires_at: z.string(),
  model: z.literal(MODEL), status: z.literal('running'), system_prompt: z.string().max(24000),
  user_prompt: z.string().min(1).max(64000), max_tokens: z.number().int().min(1).max(8192),
  response_schema: z.record(z.string(), z.unknown()).nullable(),
});
type Job = z.infer<typeof jobSchema>;
type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
class FatalAuth extends Error {}
export class QueueUnavailable extends Error {}
export async function readBoundedJson(response: Response) {
  const limit = 1024 * 1024;
  const declared = Number(response.headers.get('content-length'));
  if (declared > limit) { await response.body?.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
}
export function createRpc(env: Record<string, string | undefined>, request: typeof fetch = fetch): Rpc {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const base = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!key || !base) throw new Error('Missing Supabase service configuration');
  const url = new URL(base);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.username || url.password) throw new Error('Invalid Supabase project URL');
  const headers: Record<string, string> = {'Content-Type':'application/json', apikey:key};
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return async (name,args) => {
    let response: Response;
    try {
      response = await request(new URL(`/rest/v1/rpc/${name}`,url), {method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(10000),redirect:'error'});
    } catch (error) {
      if (error instanceof Error && ['TimeoutError','AbortError','TypeError'].includes(error.name)) throw new QueueUnavailable('Queue connection unavailable');
      throw error;
    }
    if (response.status === 401 || response.status === 403) throw new FatalAuth(`Supabase authentication failed HTTP ${response.status}; check service key and role grants`);
    if (response.status===408 || response.status===429 || response.status>=500) throw new QueueUnavailable('Queue service temporarily unavailable');
    if (!response.ok) throw new Error(`Queue RPC failed HTTP ${response.status}`);
    return readBoundedJson(response);
  };
}
export async function inferJob(job: Job, request: typeof fetch = fetch) {
  const promptBytes = Buffer.byteLength(job.system_prompt + job.user_prompt, 'utf8');
  if (promptBytes > 24000) throw new Error('PROMPT_TOO_LARGE');
  // Conservative byte-per-token bound reserves output plus chat-template overhead.
  if (promptBytes + job.max_tokens + 512 > 16384) throw new Error('CONTEXT_BUDGET_EXCEEDED');
  const remaining = Date.parse(job.lease_expires_at)-Date.now();
  if (!Number.isFinite(remaining) || remaining < 270000) throw new Error('LEASE_TOO_SHORT');
  // Validate schema conversion before spending local inference time. Unsupported schemas fail closed.
  const validator = job.response_schema ? z.fromJSONSchema(job.response_schema) : null;
  const response = await request('http://127.0.0.1:11434/api/chat',{
    method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(240000),
    body:JSON.stringify({model:MODEL,stream:false,think:false,keep_alive:'1m',options:{temperature:0,repeat_penalty:1.1,num_ctx:16384,num_predict:job.max_tokens},
      ...(job.response_schema ? {format:job.response_schema}:{}),
      messages:[{role:'system',content:job.system_prompt},{role:'user',content:job.user_prompt}]}),
  });
  if (response.status===401 || response.status===403) throw new FatalAuth(`Ollama authentication failed HTTP ${response.status}; inspect local service`);
  if (!response.ok) throw new Error('OLLAMA_HTTP_FAILURE');
  const data = await readBoundedJson(response);
  if (data.done_reason==='length') throw new Error('OLLAMA_OUTPUT_LIMIT');
  if (data.model!==MODEL || data.done!==true || data.done_reason!=='stop' || data.message?.role!=='assistant') throw new Error('OLLAMA_INCOMPLETE_OR_WRONG_MODEL');
  const text=z.string().trim().min(1).max(100000).parse(data.message.content);
  if (validator) validator.parse(JSON.parse(text));
  const inputTokens=z.number().int().min(0).parse(data.prompt_eval_count);
  const outputTokens=z.number().int().min(0).parse(data.eval_count);
  return {text,inputTokens,outputTokens};
}
export async function runOnce(rpc:Rpc, workerId:string, request:typeof fetch=fetch) {
  const claimed = await rpc('claim_local_inference_job',{p_worker_id:workerId});
  if (!Array.isArray(claimed) || claimed.length>1) throw new Error('Invalid claim response');
  if (!claimed.length) return 'idle';
  const job=jobSchema.parse(claimed[0]);
  let result;
  try { result=await inferJob(job,request); }
  catch(error) {
    if (error instanceof FatalAuth) throw error; // Never loop on authorization errors.
    const safeCode = error instanceof Error && /^[A-Z_]{3,80}$/.test(error.message) ? error.message : 'LOCAL_INFERENCE_OR_VALIDATION_FAILED';
    const accepted=await rpc('finish_local_inference_job',{p_job_id:job.id,p_lease_token:job.lease_token,p_text:'',p_input_tokens:0,p_output_tokens:0,p_error:safeCode});
    if (accepted!==true) throw new Error('Lease rejected failed-job finalization');
    return 'failed';
  }
  const accepted=await rpc('finish_local_inference_job',{p_job_id:job.id,p_lease_token:job.lease_token,p_text:result.text,p_input_tokens:result.inputTokens,p_output_tokens:result.outputTokens,p_error:null});
  if (accepted!==true) throw new Error('Lease rejected completion; output discarded');
  return 'completed';
}
async function main() {
  const args=process.argv.slice(2);
  if(args.length!==1 || !['--once','--loop'].includes(args[0])) throw new Error('Usage: npx tsx scripts/local-inference-worker.ts --once|--loop');
  config({path:'.env.local',quiet:true}); config({path:'.env',quiet:true});
  const rpc=createRpc(process.env);
  const lockPath=join(tmpdir(),'fhcontent-local-inference-worker.lock');
  let lock;
  try {lock=await open(lockPath,'wx');} catch {throw new Error('Worker lock exists; verify no worker is running before removing stale lock');}
  let stop=false;const onStop=()=>{stop=true;};process.on('SIGINT',onStop);process.on('SIGTERM',onStop);
  const workerId=`local-${randomUUID()}`;
  try {
    await lock.writeFile(String(process.pid));
    do {
      let state: string;
      try { state=await runOnce(rpc,workerId); }
      catch (error) {
        if (!(error instanceof QueueUnavailable) || args[0]==='--once') throw error;
        console.log('Local inference worker: queue temporarily unavailable; retrying in 30 seconds');
        await new Promise(r=>setTimeout(r,30000));
        continue;
      }
      console.log(`Local inference worker: ${state}`);
      if(args[0]==='--once' || stop)break;
      await new Promise(r=>setTimeout(r,state==='idle'?5000:1000));
    } while(!stop);
  } finally {await lock.close();await unlink(lockPath);process.off('SIGINT',onStop);process.off('SIGTERM',onStop);}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error(error instanceof FatalAuth?error.message:`Local inference worker stopped (${error instanceof Error ? error.name : 'unknown error'}); inspect configuration, service health, or lease status. No automatic cloud fallback.`);process.exitCode=1;});
}



