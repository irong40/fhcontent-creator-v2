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

type StoredRow = Pick<CacheRow, 'status' | 'result_text' | 'input_tokens' | 'output_tokens'>;

/**
 * Stores the draft and returns the one that is stored: when two passes overlap the first write wins and both use it.
 * If the stored draft cannot be read back the draft in hand is returned: it must not throw, because the cron route
 * counts a throw as a retry and retry_count is part of the cache key, which would abandon the stored draft anyway.
 * The cost is a rare second judge job for a draft the cache holds under another text.
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
    try {
        const stored = await readCachedDraft(key);
        if (stored) return stored;
        // The upsert kept an unusable row: replace it, matching the exact text it holds so a concurrent repair wins.
        const { data: old, error: oldError } = await db.from('local_inference_jobs').select('status,result_text,input_tokens,output_tokens').eq('request_key', key).maybeSingle();
        if (oldError) throw new Error(`Draft cache repair read failed (${oldError.code ?? 'database'})`);
        if (!old) return draft;
        const q = db.from('local_inference_jobs').update(row).eq('request_key', key);
        const { error: fixError } = await ((old as StoredRow).result_text === null ? q.is('result_text', null) : q.eq('result_text', (old as StoredRow).result_text as string));
        if (fixError) throw new Error(`Draft cache repair failed (${fixError.code ?? 'database'})`);
        return (await readCachedDraft(key)) ?? draft;
    } catch (e) {
        console.error(e instanceof Error ? e.message : 'Draft cache re-read failed');
        return draft;
    }
}
