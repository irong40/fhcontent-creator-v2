import {describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({or:vi.fn(),paid:vi.fn(),tables:[] as string[]}));
vi.mock('@/lib/supabase/server',()=>({createAdminClient:()=>({from:(table:string)=>{state.tables.push(table);const chain={select:()=>chain,in:()=>chain,or:(v:string)=>{state.or(v);return chain;},lte:()=>chain,order:async()=>({data:[{id:'held',status:'content_ready',requires_review:true,persona_id:'persona',personas:{}}],error:null})};return chain;}})}));
vi.mock('../middleware',()=>({validateCronSecret:()=>true}));
vi.mock('@/lib/workflow-lock',()=>({acquireLock:async()=> 'lock',releaseLock:vi.fn()}));
vi.mock('@/lib/blotato',()=>({blotato:{createVideoFromPrompt:state.paid}}));
vi.mock('@/lib/openai',()=>({openai:{}}));
vi.mock('@/lib/gemini',()=>({gemini:{}}));
vi.mock('@/lib/claude',()=>({claude:{}}));
vi.mock('@/lib/storage',()=>({uploadAudio:state.paid,uploadImage:state.paid}));
vi.mock('@/lib/utils',()=>({estimateDalleCost:()=>0}));
vi.mock('@/lib/notifications',()=>({notifyError:vi.fn()}));
vi.mock('@/lib/carousel-slide',()=>({generateSlideWithLadder:state.paid,serializeAttempts:vi.fn()}));
vi.mock('@/lib/photo-provider',()=>({generatePhotoCascade:state.paid}));
vi.mock('@/lib/archival',()=>({buildArchivalQueries:vi.fn(),findArchivalImages:state.paid,ARCHIVAL_AUDIT_RULES:''}));
vi.mock('@/lib/huva-template',()=>({renderHuvaSlide:state.paid}));
vi.mock('@/lib/quote-template',()=>({renderQuoteCard:state.paid}));
import {GET} from './route';
describe('media text review hold',()=>{
 it('filters held topics and rejects one returned anyway before media calls',async()=>{
  const res=await GET(new Request('https://fixture/api/cron/daily-media'));
  expect(res.status).toBe(200);expect((await res.json()).processed).toBe(0);
  expect(state.or).toHaveBeenCalledWith('requires_review.is.null,requires_review.eq.false');
  expect(state.tables).toEqual(['topics']);expect(state.paid).not.toHaveBeenCalled();
 });
});
