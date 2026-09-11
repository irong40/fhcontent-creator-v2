import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const state=vi.hoisted(()=>({user:{id:'11111111-1111-4111-8111-111111111111'} as {id:string}|null,topic:{status:'content_ready',requires_review:true},pieces:[{id:'p',script:'Saved draft'}],updated:true,updates:[] as Record<string,unknown>[],filters:[] as unknown[]}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:state.user},error:null})}}),createAdminClient:()=>({from:(table:string)=>{
 const chain={select:()=>chain,eq:(...args:unknown[])=>{state.filters.push(args);return chain;},single:async()=>({data:state.topic,error:null}),update:(data:Record<string,unknown>)=>{state.updates.push(data);return chain;},maybeSingle:async()=>({data:state.updated?{id:'t'}:null,error:null}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='content_pieces'?state.pieces:null,error:null}).then(resolve)};return chain;
}})}));
import {POST} from './route';
const invoke=()=>POST(new NextRequest('https://example/api/topics/id/review-text',{method:'POST',headers:{authorization:'Bearer cron-synthetic'}}),{params:Promise.resolve({id:'22222222-2222-4222-8222-222222222222'})});
beforeEach(()=>{state.user={id:'11111111-1111-4111-8111-111111111111'};state.topic={status:'content_ready',requires_review:true};state.pieces=[{id:'p',script:'Saved draft'}];state.updated=true;state.updates=[];state.filters=[];});
describe('human text review gate',()=>{
 it('cron bearer without authenticated user cannot approve',async()=>{state.user=null;expect((await invoke()).status).toBe(401);expect(state.updates).toHaveLength(0);});
 it('records authenticated reviewer and preserves content_ready',async()=>{const response=await invoke();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'content_ready',requires_review:false});expect(state.updates[0]).toMatchObject({requires_review:false,reviewed_by:state.user!.id});expect(state.updates[0]).not.toHaveProperty('status');expect(state.updates[0].reviewed_at).toEqual(expect.any(String));expect(state.filters).toContainEqual(['requires_review',true]);});
 it('rejects other status',async()=>{state.topic.status='draft';expect((await invoke()).status).toBe(409);});
 it('rejects already cleared hold',async()=>{state.topic.requires_review=false;expect((await invoke()).status).toBe(409);});
 it('rejects no pieces',async()=>{state.pieces=[];expect((await invoke()).status).toBe(400);expect(state.updates).toHaveLength(0);});
 it('rejects empty text',async()=>{state.pieces[0].script=' ';expect((await invoke()).status).toBe(400);});
 it('rejects concurrent state change',async()=>{state.updated=false;expect((await invoke()).status).toBe(409);});
});
