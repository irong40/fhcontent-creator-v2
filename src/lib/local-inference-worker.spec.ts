import {describe,it,expect,vi} from 'vitest';
import {createRpc,runOnce,inferJob,readBoundedJson,QueueUnavailable} from '../../scripts/local-inference-worker';
const job={id:'11111111-1111-4111-8111-111111111111',lease_token:'22222222-2222-4222-8222-222222222222',lease_expires_at:new Date(Date.now()+300000).toISOString(),model:'qwen3:8b' as const,status:'running' as const,system_prompt:'Transform supplied text.',user_prompt:'Synthetic source.',max_tokens:100,response_schema:{type:'object',properties:{title:{type:'string'}},required:['title'],additionalProperties:false}};
const output={model:'qwen3:8b',done:true,done_reason:'stop',message:{role:'assistant',content:'{"title":"Draft"}'},prompt_eval_count:12,eval_count:8};
const response=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status}));
describe('local inference worker',()=>{
 it('distinguishes temporary queue transport failure from authentication failure',async()=>{
  const env={SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'};
  await expect(createRpc(env,vi.fn().mockRejectedValue(new TypeError('fetch failed')))('claim_local_inference_job',{})).rejects.toBeInstanceOf(QueueUnavailable);
  await expect(createRpc(env,vi.fn(()=>response({},503)))('claim_local_inference_job',{})).rejects.toBeInstanceOf(QueueUnavailable);
  await expect(createRpc(env,vi.fn(()=>response({},401)))('claim_local_inference_job',{})).rejects.not.toBeInstanceOf(QueueUnavailable);
 });
 it('claims completes and preserves lease plus token counts',async()=>{
  const rpc=vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce(true);
  const request=vi.fn().mockImplementation(()=>response(output));
  expect(await runOnce(rpc,'test-worker',request)).toBe('completed');
  expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
  const body=JSON.parse(request.mock.calls[0][1].body);expect(body.think).toBe(false);expect(body.model).toBe('qwen3:8b');
  expect(rpc.mock.calls[1][1]).toMatchObject({p_lease_token:job.lease_token,p_input_tokens:12,p_output_tokens:8,p_error:null});
 });
 it('idle performs no inference',async()=>{const req=vi.fn();expect(await runOnce(vi.fn().mockResolvedValue([]),'w',req)).toBe('idle');expect(req).not.toHaveBeenCalled();});
 it.each([
  [{...output,model:'other'},'OLLAMA_INCOMPLETE_OR_WRONG_MODEL'],
  [{...output,done:false},'OLLAMA_INCOMPLETE_OR_WRONG_MODEL'],
  [{...output,done_reason:'length'},'OLLAMA_OUTPUT_LIMIT'],
  [{...output,eval_count:-1},'LOCAL_INFERENCE_OR_VALIDATION_FAILED'],
  [{...output,message:{role:'assistant',content:'{"title":7}'}},'LOCAL_INFERENCE_OR_VALIDATION_FAILED'],
  [{...output,message:{role:'assistant',content:'not json'}},'LOCAL_INFERENCE_OR_VALIDATION_FAILED'],
 ])('rejects invalid local output %# with a safe diagnostic',async(data,expectedError)=>{
  const rpc=vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce(true);
  expect(await runOnce(rpc,'w',vi.fn(()=>response(data)))).toBe('failed');
  expect(rpc.mock.calls[1][1]).toMatchObject({p_text:'',p_error:expectedError});
 });
 it('stale finalization cannot report completion',async()=>{const rpc=vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce(false);await expect(runOnce(rpc,'w',vi.fn(()=>response(output)))).rejects.toThrow('Lease rejected');});
 it('does not infer on nearly expired lease',async()=>{const req=vi.fn();await expect(inferJob({...job,lease_expires_at:new Date().toISOString()},req)).rejects.toThrow('LEASE_TOO_SHORT');expect(req).not.toHaveBeenCalled();});
 it('uses sb_secret only in apikey and stops on auth failure',async()=>{
  const req=vi.fn(()=>response({},401));const rpc=createRpc({SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'},req);
  await expect(rpc('claim_local_inference_job',{})).rejects.toThrow('authentication failed');
  expect(req.mock.calls).toHaveLength(1);const headers=(req.mock.calls[0] as unknown as [string,RequestInit])[1].headers as Record<string,string>;
  expect(headers.apikey).toBe('sb_secret_synthetic');expect(headers.Authorization).toBeUndefined();
 });
 it('Ollama auth failure stops without requeue',async()=>{const rpc=vi.fn().mockResolvedValueOnce([job]);await expect(runOnce(rpc,'w',vi.fn(()=>response({},403)))).rejects.toThrow('authentication failed');expect(rpc).toHaveBeenCalledTimes(1);});
});


describe('worker resource bounds',()=>{
 it('honors requested 8192 output tokens',async()=>{
  const request=vi.fn().mockImplementation(()=>response(output));
  await inferJob({...job,max_tokens:8192},request);
  expect(JSON.parse(request.mock.calls[0][1].body).options.num_predict).toBe(8192);
 });
 it('rejects combined UTF8 input before inference',async()=>{
  const request=vi.fn();
  await expect(inferJob({...job,system_prompt:'é'.repeat(6001),user_prompt:'é'.repeat(6000)},request)).rejects.toThrow('PROMPT_TOO_LARGE');
  expect(request).not.toHaveBeenCalled();
 });
 it('reserves thirty seconds beyond inference timeout',async()=>{
  const request=vi.fn();await expect(inferJob({...job,lease_expires_at:new Date(Date.now()+269000).toISOString()},request)).rejects.toThrow('LEASE_TOO_SHORT');expect(request).not.toHaveBeenCalled();
 });
 it('rejects declared oversized responses',async()=>{
  await expect(readBoundedJson(new Response('{}',{headers:{'content-length':String(1048577)}}))).rejects.toThrow('RESPONSE_TOO_LARGE');
 });
 it('rejects streamed oversize without content length and cancels stream',async()=>{
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}});
  await expect(readBoundedJson(new Response(stream))).rejects.toThrow('RESPONSE_TOO_LARGE');expect(cancelled).toBe(true);
 });
 it('allows small JSON response',async()=>{expect(await readBoundedJson(new Response('{"ok":true}'))).toEqual({ok:true});});
});

describe('conservative context budget',()=>{
 it('rejects prompt plus requested output above context before inference',async()=>{
  const request=vi.fn();
  await expect(inferJob({...job,system_prompt:'a'.repeat(7681),user_prompt:'b',max_tokens:8192},request)).rejects.toThrow('CONTEXT_BUDGET_EXCEEDED');
  expect(request).not.toHaveBeenCalled();
 });
 it('accepts exact context budget without trimming source or output',async()=>{
  const request=vi.fn().mockImplementation(()=>response(output));
  const source='a'.repeat(7679);
  await inferJob({...job,system_prompt:source,user_prompt:'b',max_tokens:8192},request);
  const body=JSON.parse(request.mock.calls[0][1].body);
  expect(body.messages[0].content).toBe(source);expect(body.options.num_predict).toBe(8192);
 });
});
