import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/server';

// A hosted draft is not repeatable: ask again and the text differs. The claim judge's queue key is a hash
// of that text, so a draft regenerated on every cron pass queued a fresh judge job each time and never
// consumed a finished one (2026-11-06: 0 pieces since 11-01). The draft is therefore stored once per
// topic, retry and prompt, and reused until the judge verdict is in. It rides in local_inference_jobs as
// an already-succeeded row, so no migration is needed and the worker (which claims only queued rows)
// never sees it.
type CacheRow = { request_key: string; system_prompt: string; user_prompt: string; max_tokens: number; model: string; status: string; result_text: string | null; input_tokens: number | null; output_tokens: number | null };
type CacheDb = { public: { Tables: { local_inference_jobs: { Row: CacheRow; Insert: Partial<CacheRow>; Update: Partial<CacheRow>; Relationships: [] } }; Views: Record<string, never>; Functions: Record<string, never> } };
export type CachedDraft = { text: string; inputTokens: number; outputTokens: number };

export function draftCacheKey(requestKey: string, system: string, user: string, maxTokens: number, schema?: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(['claude-draft', 1, requestKey, system, user, maxTokens, schema ?? null])).digest('hex');
}

export async function readCachedDraft(key: string): Promise<CachedDraft | null> {
    const db = createAdminClient() as unknown as SupabaseClient<CacheDb>;
    const { data, error } = await db.from('local_inference_jobs').select('status,result_text,input_tokens,output_tokens').eq('request_key', key).maybeSingle();
    if (error) throw new Error(`Draft cache read failed (${error.code ?? 'database'})`);
    if (!data || data.status !== 'succeeded' || !data.result_text?.trim() || data.input_tokens == null || data.output_tokens == null) return null;
    return { text: data.result_text, inputTokens: data.input_tokens, outputTokens: data.output_tokens };
}

// A row that exists but cannot be served (not succeeded, empty text, missing token counts). readCachedDraft treats it
// as a miss, so the write must be allowed to replace it or that key pays for a new draft on every pass.
const UNUSABLE_ROW = 'status.neq.succeeded,result_text.is.null,result_text.eq.,input_tokens.is.null,output_tokens.is.null';

/**
 * Stores the draft and returns the one that is stored: when two passes overlap the first write wins and both use it.
 * If the stored draft cannot be read back this throws rather than hand back a draft the cache may not hold, because
 * the claim judge is keyed on the returned text; the next pass finds the stored draft and reuses it.
 */
export async function writeCachedDraft(key: string, draft: CachedDraft): Promise<CachedDraft> {
    const db = createAdminClient() as unknown as SupabaseClient<CacheDb>;
    const row = {
        request_key: key, system_prompt: 'hosted draft cache', user_prompt: 'hosted draft cache', max_tokens: 1, model: 'qwen3:8b',
        status: 'succeeded', result_text: draft.text, input_tokens: draft.inputTokens, output_tokens: draft.outputTokens,
    };
    const { error } = await db.from('local_inference_jobs').upsert(row, { onConflict: 'request_key', ignoreDuplicates: true });
    // A failed write only costs a second paid draft on the next pass; it must not lose the draft in hand.
    if (error) { console.error(`Draft cache write failed (${error.code ?? 'database'})`); return draft; }
    let stored = await readCachedDraft(key).catch((e) => { console.error(e instanceof Error ? e.message : 'Draft cache re-read failed'); return undefined; });
    if (stored === undefined) throw new Error('Draft cache re-read failed after write');
    if (stored) return stored;
    // The upsert kept an unusable row: replace it, only while it is still unusable, then take whatever is stored.
    const { error: fixError } = await db.from('local_inference_jobs').update(row).eq('request_key', key).or(UNUSABLE_ROW);
    if (fixError) { console.error(`Draft cache repair failed (${fixError.code ?? 'database'})`); return draft; }
    stored = await readCachedDraft(key).catch(() => undefined);
    if (stored === undefined) throw new Error('Draft cache re-read failed after repair');
    return stored ?? draft;
}
