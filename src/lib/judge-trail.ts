import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Judge progress trail (HR-7). Transport success is not topic progress, so every step a judge
 * request takes is one row in judge_trail under ONE correlation id: queue wait, inference,
 * validation, business state, escalation, the channel each alert actually used, and the
 * acknowledged outcome. Records only: nothing here sends an alert or calls a model.
 */
export const TRAIL_STAGES = [
    'enqueued', 'claimed', 'inference_done', 'validated', 'state_changed', 'escalated', 'alert_channel', 'acknowledged',
] as const;
export type TrailStage = (typeof TRAIL_STAGES)[number];
export type AlertChannel = 'resend' | 'db' | 'webhook';
export type ChannelOutcome = 'sent' | 'failed' | 'skipped';

export type TrailEvent = {
    correlation_id: string;
    stage: TrailStage;
    topic_id: string;
    topic_version: string;
    job_id?: string | null;
    at: string;
    /** state_changed: { advanced: boolean, to: string }; alert_channel: { channel, outcome, note? }; validated: { ok: boolean } */
    detail?: Record<string, unknown>;
};

/** Same request, topic and version always give the same id, so a retried job keeps it. */
export function correlationId(topicId: string, topicVersion: string, requestKey: string): string {
    return createHash('sha256').update(`${topicId}\n${topicVersion}\n${requestKey}`).digest('hex').slice(0, 24);
}

type TrailDatabase = { public: { Tables: { judge_trail: { Row: TrailEvent; Insert: TrailEvent; Update: Partial<TrailEvent>; Relationships: [] } };
    Views: Record<string, never>; Functions: Record<string, never> } };

/** Best effort: a trail failure must never block the pipeline or the alert it describes. */
export async function recordTrail(client: unknown, event: Omit<TrailEvent, 'at'> & { at?: string }): Promise<boolean> {
    try {
        const db = client as SupabaseClient<TrailDatabase>;
        const { error } = await db.from('judge_trail').insert({ ...event, at: event.at ?? new Date().toISOString() });
        return !error;
    } catch {
        return false;
    }
}

export type StuckReason = 'judge_exhausted' | 'no_state_change' | 'escalated_no_channel_delivered' | 'escalated_unacknowledged' | 'judge_rejected';
export type TopicProgress = {
    topic_id: string; topic_version: string; correlation_ids: string[]; last_stage: TrailStage; last_at: string;
    queue_wait_s: number | null; inference_s: number | null;
    advanced: boolean; stuck_reason: StuckReason | null;
    /** Channels whose own record says sent. Empty means no record of delivery, not "no alert". */
    channels_sent: AlertChannel[]; channels_failed: AlertChannel[];
};
export type ProgressReport = { generated_at: string; advanced: TopicProgress[]; did_not_advance: TopicProgress[]; in_flight: TopicProgress[] };

const secs = (a?: string, b?: string) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

/**
 * Groups trail rows by topic+version and says which topics advanced. Advanced = a state_changed
 * row with advanced:true. Not advanced and older than stuckAfterMs = did_not_advance with the
 * reason read from the records. Younger rows stay in_flight.
 */
export function buildProgressReport(events: TrailEvent[], now: Date, stuckAfterMs = 30 * 60_000): ProgressReport {
    const groups = new Map<string, TrailEvent[]>();
    for (const e of events) {
        const key = `${e.topic_id}\n${e.topic_version}`;
        groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const out: ProgressReport = { generated_at: now.toISOString(), advanced: [], did_not_advance: [], in_flight: [] };
    for (const group of groups.values()) {
        const sorted = [...group].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || TRAIL_STAGES.indexOf(a.stage) - TRAIL_STAGES.indexOf(b.stage));
        const first = (s: TrailStage) => sorted.find(e => e.stage === s);
        const last = sorted[sorted.length - 1];
        const channelRows = sorted.filter(e => e.stage === 'alert_channel');
        const sent = new Set<AlertChannel>(), failed = new Set<AlertChannel>();
        for (const c of channelRows) {
            const ch = c.detail?.channel as AlertChannel, outcome = c.detail?.outcome;
            if (outcome === 'sent') sent.add(ch); else if (outcome === 'failed') failed.add(ch);
        }
        const advanced = sorted.some(e => e.stage === 'state_changed' && e.detail?.advanced === true);
        const escalated = sorted.some(e => e.stage === 'escalated');
        const acknowledged = sorted.some(e => e.stage === 'acknowledged');
        const exhausted = sorted.some(e => e.stage === 'inference_done' && e.detail?.exhausted === true);
        const rejected = sorted.some(e => e.stage === 'validated' && e.detail?.ok === false);
        let reason: StuckReason | null = null;
        if (!advanced) {
            if (escalated && sent.size === 0) reason = 'escalated_no_channel_delivered';
            else if (escalated && !acknowledged) reason = 'escalated_unacknowledged';
            else if (exhausted) reason = 'judge_exhausted';
            else if (rejected) reason = 'judge_rejected';
            else reason = 'no_state_change';
        }
        const row: TopicProgress = {
            topic_id: last.topic_id, topic_version: last.topic_version,
            correlation_ids: [...new Set(sorted.map(e => e.correlation_id))],
            last_stage: last.stage, last_at: last.at,
            queue_wait_s: secs(first('enqueued')?.at, first('claimed')?.at),
            inference_s: secs(first('claimed')?.at, sorted.find(e => e.stage === 'inference_done')?.at),
            advanced, stuck_reason: reason, channels_sent: [...sent], channels_failed: [...failed],
        };
        // An escalation with no delivery record or no acknowledgement is reported at once; otherwise wait out stuckAfterMs.
        const urgent = reason === 'escalated_no_channel_delivered' || reason === 'escalated_unacknowledged' || reason === 'judge_exhausted';
        if (advanced) out.advanced.push(row);
        else if (urgent || now.getTime() - Date.parse(last.at) >= stuckAfterMs) out.did_not_advance.push(row);
        else out.in_flight.push(row);
    }
    return out;
}

export function renderProgressReport(r: ProgressReport): string {
    const line = (t: TopicProgress) => `- topic ${t.topic_id} v${t.topic_version} | ${t.stuck_reason ?? 'advanced'} | last ${t.last_stage} at ${t.last_at} | queue wait ${t.queue_wait_s ?? 'n/a'}s, inference ${t.inference_s ?? 'n/a'}s | alert channels sent: ${t.channels_sent.join(',') || 'no record'}${t.channels_failed.length ? ` (failed: ${t.channels_failed.join(',')})` : ''} | correlation ${t.correlation_ids.join(',')}`;
    return [`# Judge progress (records only) ${r.generated_at}`, `## Did not advance (${r.did_not_advance.length})`, ...r.did_not_advance.map(line),
        `## In flight (${r.in_flight.length})`, ...r.in_flight.map(line), `## Advanced (${r.advanced.length})`, ...r.advanced.map(line)].join('\n');
}
