import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createAdminClient } from './supabase/server';

const requestSchema = z.object({
    requestKey: z.string().trim().min(1).max(256),
    system: z.string().min(1).max(24000),
    user: z.string().min(1).max(64000),
    maxTokens: z.number().int().min(1).max(8192),
    schema: z.record(z.string(), z.json()).optional(),
}).strict();
export type LocalInferenceRequest = {
    requestKey: string; system: string; user: string; maxTokens: number;
    schema?: Record<string, unknown>;
};
type QueueRow = {
    id: string; request_key: string; system_prompt: string; user_prompt: string;
    max_tokens: number; response_schema: Record<string, unknown> | null; model: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed'; result_text: string | null;
    input_tokens: number | null; output_tokens: number | null;
};
// This isolated migration's transport types avoid changing generated business types.
type QueueDatabase = { public: {
    Tables: { local_inference_jobs: { Row: QueueRow; Insert: Partial<QueueRow>; Update: Partial<QueueRow>; Relationships: [] } };
    Views: Record<string, never>; Functions: Record<string, never>;
} };
function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export class LocalInferencePendingError extends Error {
    constructor(public readonly jobId: string) {
        super('Local inference queued or running; retry this request after the local worker completes.');
        this.name = 'LocalInferencePendingError';
    }
}

/**
 * Durable deduplicated transport. No polling, paid fallback, approval, or publishing.
 * Worker contract (service role only): claim_local_inference_job(p_worker_id) returns
 * zero or one complete row with a new lease_token, 300-second lease and attempts <= 3.
 * finish_local_inference_job(p_job_id,p_lease_token,p_text,p_input_tokens,p_output_tokens,p_error)
 * returns false for a stale/expired lease; errors retry up to three attempts, then fail.
 * Caller retries the SAME logical request after PendingError; never regenerates a key
 * each poll. Changed effective prompt/schema/model inputs automatically get a new hash.
 * Completion means inference transport succeeded; existing content review gates still apply.
 */
export async function getOrEnqueueLocalInference(input: LocalInferenceRequest): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    // Zod-generated JSON Schema carries a non-enumerable ~standard adapter
    // containing functions. Transport only its enumerable JSON fields.
    const request = requestSchema.parse({ ...input, schema: input.schema ? { ...input.schema } : undefined });
    const promptBytes = Buffer.byteLength(request.system, 'utf8') + Buffer.byteLength(request.user, 'utf8');
    if (promptBytes > 24000) {
        throw new Error('Local inference prompts exceed the 24000-byte context budget');
    }
    // Byte count conservatively bounds input tokens; reserve chat framing and output.
    if (promptBytes + request.maxTokens + 512 > 16384) {
        throw new Error('Local inference prompt and output exceed the 16384-token context budget');
    }
    const serializedSchema = JSON.stringify(request.schema ?? null);
    if (serializedSchema.length > 24000) throw new Error('Local response schema exceeds limit');
    const requestKey = createHash('sha256').update(canonical({ version: 1, model: 'qwen3:8b', ...request, schema: request.schema ?? null })).digest('hex');
    const db = createAdminClient() as unknown as SupabaseClient<QueueDatabase>;
    const { error: insertError } = await db.from('local_inference_jobs').upsert({
        request_key: requestKey, system_prompt: request.system, user_prompt: request.user,
        max_tokens: request.maxTokens, response_schema: request.schema ?? null, model: 'qwen3:8b',
    }, { onConflict: 'request_key', ignoreDuplicates: true }).select('id');
    if (insertError) throw new Error(`Local inference enqueue failed (${insertError.code ?? 'database'}); no cloud fallback`);
    const { data: row, error } = await db.from('local_inference_jobs')
        .select('id,status,result_text,input_tokens,output_tokens').eq('request_key', requestKey).single();
    if (error || !row) throw new Error(`Local inference read failed (${error?.code ?? 'missing'}); no cloud fallback`);
    if (row.status === 'queued' || row.status === 'running') throw new LocalInferencePendingError(row.id);
    if (row.status === 'failed') throw new Error(`Local inference job ${row.id} exhausted its bounded attempts; human review required`);
    if (row.status !== 'succeeded' || !row.result_text?.trim() || !Number.isInteger(row.input_tokens) || !Number.isInteger(row.output_tokens) || row.input_tokens! < 0 || row.output_tokens! < 0) {
        throw new Error('Invalid local inference completion; human review required');
    }
    return { text: row.result_text, inputTokens: row.input_tokens!, outputTokens: row.output_tokens! };
}
