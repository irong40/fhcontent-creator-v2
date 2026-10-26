/**
 * Holds a hosted (Claude) draft while its claim-judge jobs run, so the next cron run checks
 * the SAME text. Added 2026-10-22.
 *
 * The judge's queue key is a hash of the draft's text (claim-check.ts callJudge). The local
 * provider is already durable: the same request returns the same draft. Claude is not: every
 * run wrote new text, enqueued new judge jobs and never read the finished ones. Du Bois
 * (dfe531cf) made 33 judge jobs in 16 hours, 13 of them clean passes, and never moved.
 *
 * Fail open: if the table is missing or a call fails, the route behaves exactly as before
 * this change (a fresh draft each run). A hold never approves or publishes anything; the
 * draft still has to pass every check.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/server';

type HoldRow = {
    request_key: string; topic_id: string; provider: 'claude';
    result_text: string; input_tokens: number; output_tokens: number; created_at: string;
};
// Isolated transport types, as in local-inference-queue.ts: no change to generated business types.
type HoldDatabase = { public: {
    Tables: { content_draft_holds: { Row: HoldRow; Insert: Omit<HoldRow, 'created_at'>; Update: Partial<HoldRow>; Relationships: [] } };
    Views: Record<string, never>; Functions: Record<string, never>;
} };

/** A hold older than this is ignored, so an unfinished judge cannot pin one draft forever (qcheck Q4). */
export const HOLD_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function describe(e: unknown): string {
    if (e && typeof e === 'object') {
        const { code, message } = e as { code?: string; message?: string };
        return [code, message].filter(Boolean).join(' ') || 'unknown error';
    }
    return String(e);
}

export type HeldDraft = { text: string; inputTokens: number; outputTokens: number };

function db() {
    return createAdminClient() as unknown as SupabaseClient<HoldDatabase>;
}

/** One key per exact request: a changed prompt, retry or schema gets a new draft. */
export function holdKey(request: { requestKey: string; system: string; user: string; maxTokens: number; schema?: Record<string, unknown> }): string {
    return createHash('sha256').update(JSON.stringify({
        version: 1, requestKey: request.requestKey, system: request.system, user: request.user,
        maxTokens: request.maxTokens, schema: request.schema ?? null,
    })).digest('hex');
}

/** The held draft for this request, or null (none held, or the hold could not be read). */
export async function readHeldDraft(key: string): Promise<HeldDraft | null> {
    try {
        const { data, error } = await db().from('content_draft_holds')
            .select('result_text,input_tokens,output_tokens,created_at').eq('request_key', key).maybeSingle();
        if (error) {
            console.warn(`draft hold not read (${describe(error)}); writing a new draft`);
            return null;
        }
        if (!data?.result_text) return null;
        const age = Date.now() - new Date(data.created_at).getTime();
        if (Number.isFinite(age) && age > HOLD_MAX_AGE_MS) {
            console.warn(`draft hold expired (${Math.round(age / 3_600_000)}h old); writing a new draft`);
            return null;
        }
        return { text: data.result_text, inputTokens: data.input_tokens, outputTokens: data.output_tokens };
    } catch (e) {
        console.warn(`draft hold not read (${describe(e)}); writing a new draft`);
        return null;
    }
}

/** Holds a draft for its topic. A failure is logged and ignored. */
export async function holdDraft(key: string, topicId: string, draft: HeldDraft): Promise<void> {
    try {
        const { error } = await db().from('content_draft_holds').upsert({
            request_key: key, topic_id: topicId, provider: 'claude',
            result_text: draft.text, input_tokens: draft.inputTokens, output_tokens: draft.outputTokens,
        }, { onConflict: 'request_key', ignoreDuplicates: true });
        if (error) console.warn(`draft hold not saved (${describe(error)}); next run writes a new draft`);
    } catch (e) {
        console.warn(`draft hold not saved (${describe(e)}); next run writes a new draft`);
    }
}

/** Drops every held draft of a topic: its attempt passed or failed. A failure is logged and ignored. */
export async function releaseDraftHolds(topicId: string): Promise<void> {
    try {
        const { error } = await db().from('content_draft_holds').delete().eq('topic_id', topicId);
        if (error) console.warn(`draft hold not released (${describe(error)})`);
    } catch (e) {
        console.warn(`draft hold not released (${describe(e)})`);
    }
}
