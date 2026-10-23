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

/**
 * The ONE id every stage of a topic+version carries: queue, inference, validation, business state,
 * escalation, alert channels and acknowledgement. A topic can send several judge requests (one per
 * piece), so the request key is kept in each queue row's detail.request_key, not in the id.
 */
export function topicCorrelationId(topicId: string, topicVersion: string): string {
    return correlationId(topicId, topicVersion, 'content-generator');
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

/**
 * Writes the row only if no row with the same id, stage and `key` fields exists yet, so a repeat
 * read or a retry does not rewrite it (and move last_at). If the check itself fails nothing is
 * written: a missing row is safer than a duplicate. Returns true only when a row was written.
 */
export async function recordTrailOnce(client: unknown, event: Omit<TrailEvent, 'at'> & { at?: string }, key: Record<string, string>): Promise<boolean> {
    try {
        const db = client as SupabaseClient<TrailDatabase>;
        let q = db.from('judge_trail').select('stage').eq('correlation_id', event.correlation_id).eq('stage', event.stage);
        for (const [k, v] of Object.entries(key)) q = q.eq(k as 'stage', v as TrailStage);
        const { data, error } = await q.limit(1);
        if (error || !Array.isArray(data) || data.length > 0) return false;
        return await recordTrail(client, event);
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
    /** Channels whose record says skipped. Together with sent and failed this is every alert_channel record. */
    channels_skipped: AlertChannel[];
    /** Channels the LATEST escalation's own alert rows (same detail.error_id) say sent; the escalation reasons read these. */
    escalation_channels_sent: AlertChannel[];
    /**
     * When the latest escalation's own error was acknowledged (ack detail.error_id equals the escalated row's, and not
     * revoked by a later un-acknowledge row), or null when no such acknowledgement is recorded.
     */
    acknowledged_at: string | null;
    /** When the latest escalation's own acknowledgement was revoked (latest revoked row, no acknowledge after it), else null. */
    acknowledgement_revoked_at: string | null;
    /** The topic has at least one escalated row. False = there is no latest alert to speak of. */
    escalated: boolean;
};

/**
 * Acknowledgement of the given error ids from the records. Per error id the rows are read in order:
 * detail.revoked === true means the error was un-acknowledged, so it is open again; the first
 * acknowledge after that closes it. Returns the earliest effective acknowledgement time among the ids, or null, and when
 * none is effective, the latest revoke time with no acknowledge after it (else null). Rows for other error
 * ids (or with no error_id) never count. Duplicate rows from a concurrent repeat write read the same.
 */
function effectiveAcknowledgement(sorted: TrailEvent[], errorIds: Set<string>): { at: string | null; revokedAt: string | null } {
    const ackedAt = new Map<string, string | null>(), revokedAt = new Map<string, string | null>();
    for (const e of sorted) {
        const id = e.detail?.error_id;
        if (e.stage !== 'acknowledged' || typeof id !== 'string' || !errorIds.has(id)) continue;
        if (e.detail?.revoked === true) { ackedAt.set(id, null); revokedAt.set(id, e.at); }
        else if (!ackedAt.get(id)) { ackedAt.set(id, e.at); revokedAt.set(id, null); } // the first ack since the last revoke; a duplicate keeps it
    }
    const times = [...ackedAt.values()].filter((t): t is string => t !== null).sort();
    const revokes = [...revokedAt.values()].filter((t): t is string => t !== null).sort();
    return { at: times[0] ?? null, revokedAt: times.length > 0 ? null : revokes[revokes.length - 1] ?? null };
}
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
        const sent = new Set<AlertChannel>(), failed = new Set<AlertChannel>(), skipped = new Set<AlertChannel>();
        for (const c of channelRows) {
            const ch = c.detail?.channel as AlertChannel, outcome = c.detail?.outcome;
            if (outcome === 'sent') sent.add(ch); else if (outcome === 'failed') failed.add(ch); else if (outcome === 'skipped') skipped.add(ch);
        }
        const advanced = sorted.some(e => e.stage === 'state_changed' && e.detail?.advanced === true);
        // The LATEST escalation decides the reason. Ownership is by exact identity, never by time: the
        // escalated row carries detail.error_id (the generator picks the errors row id before it writes
        // escalated, and notifyError puts that same id on each channel row). Its delivery is the
        // alert_channel rows with that error_id, and an acknowledgement counts only when its
        // detail.error_id equals it. A late row from an earlier error on the same topic+version carries
        // the earlier id, so it neither delivers nor closes this one. No error_id on the escalation =
        // identity unknown = no delivery and no acknowledgement (fail closed).
        const latestEscalation = [...sorted].reverse().find(e => e.stage === 'escalated');
        const escalated = latestEscalation !== undefined;
        const escalationErrorId = typeof latestEscalation?.detail?.error_id === 'string' && latestEscalation.detail.error_id !== ''
            ? latestEscalation.detail.error_id : null;
        const ownRows = escalationErrorId !== null ? channelRows.filter(e => e.detail?.error_id === escalationErrorId) : [];
        const ownSent = new Set<AlertChannel>(ownRows.filter(e => e.detail?.outcome === 'sent').map(e => e.detail?.channel as AlertChannel));
        const ack = escalationErrorId !== null ? effectiveAcknowledgement(sorted, new Set([escalationErrorId])) : { at: null, revokedAt: null };
        const acknowledgedAt = ack.at;
        const acknowledged = acknowledgedAt !== null;
        const exhausted = sorted.some(e => e.stage === 'inference_done' && e.detail?.exhausted === true);
        const rejected = sorted.some(e => e.stage === 'validated' && e.detail?.ok === false);
        let reason: StuckReason | null = null;
        if (!advanced) {
            if (escalated && ownSent.size === 0) reason = 'escalated_no_channel_delivered';
            else if (escalated && !acknowledged) reason = 'escalated_unacknowledged';
            else if (exhausted) reason = 'judge_exhausted';
            else if (rejected) reason = 'judge_rejected';
            else reason = 'no_state_change';
        }
        const row: TopicProgress = {
            topic_id: last.topic_id, topic_version: last.topic_version,
            correlation_ids: [...new Set(sorted.map(e => e.correlation_id))],
            last_stage: last.stage, last_at: last.at,
            // From the enqueued row; if that write was lost, from the wait the claimed row recorded off the job row.
            queue_wait_s: secs(first('enqueued')?.at, first('claimed')?.at)
                ?? (typeof first('claimed')?.detail?.queue_wait_ms === 'number' ? Math.max(0, Math.round((first('claimed')!.detail!.queue_wait_ms as number) / 1000)) : null),
            inference_s: secs(first('claimed')?.at, sorted.find(e => e.stage === 'inference_done')?.at),
            advanced, stuck_reason: reason, channels_sent: [...sent], channels_failed: [...failed],
            channels_skipped: [...skipped], escalation_channels_sent: [...ownSent], acknowledged_at: acknowledgedAt,
            acknowledgement_revoked_at: ack.revokedAt, escalated,
        };
        // An escalation with no delivery record or no acknowledgement is reported at once; otherwise wait out stuckAfterMs.
        const urgent = reason === 'escalated_no_channel_delivered' || reason === 'escalated_unacknowledged' || reason === 'judge_exhausted';
        if (advanced) out.advanced.push(row);
        else if (urgent || now.getTime() - Date.parse(last.at) >= stuckAfterMs) out.did_not_advance.push(row);
        else out.in_flight.push(row);
    }
    // Oldest stuck first: longest since the last recorded step, ties by topic then version.
    const oldestFirst = (a: TopicProgress, b: TopicProgress) => Date.parse(a.last_at) - Date.parse(b.last_at)
        || (a.topic_id < b.topic_id ? -1 : a.topic_id > b.topic_id ? 1 : 0) || (a.topic_version < b.topic_version ? -1 : a.topic_version > b.topic_version ? 1 : 0);
    out.advanced.sort(oldestFirst); out.did_not_advance.sort(oldestFirst); out.in_flight.sort(oldestFirst);
    return out;
}

/** Printed text for each reason (Content Manager review E1 to E5). The code stays the stable key. */
export function reasonText(t: TopicProgress): string {
    switch (t.stuck_reason) {
        case 'judge_exhausted': return 'Judge job recorded as exhausted after its bounded attempts (max 3); needs human review.';
        case 'no_state_change': return `No state change recorded; last recorded step: ${t.last_stage}.`;
        case 'judge_rejected': return 'Judge rejected the claims (validation failed); no state change recorded since.';
        case 'escalated_no_channel_delivered': return 'Alert raised; no channel record for the latest alert says sent (no record is not proof that nothing was sent).';
        case 'escalated_unacknowledged': return `Latest alert sent on ${t.escalation_channels_sent.join(', ')} (send receipt, not proof it was read); `
            + (t.acknowledgement_revoked_at ? `its acknowledgement was revoked at ${t.acknowledgement_revoked_at}, none since.` : 'no acknowledgement of it recorded.');
        default: return '';
    }
}

/** Every alert_channel outcome from the records; 'no record' only when the topic has no alert_channel row at all (E6). */
function channelRecords(t: TopicProgress): string {
    const parts = ([['sent', t.channels_sent], ['failed', t.channels_failed], ['skipped', t.channels_skipped]] as const)
        .filter(([, chs]) => chs.length > 0).map(([outcome, chs]) => `${outcome}: ${chs.join(',')}`);
    return parts.join('; ') || 'no record';
}

/** E7: 'no record' only when the latest alert has no acknowledge or revoke row; no escalated row at all says so. */
function acknowledgementRecord(t: TopicProgress): string {
    if (!t.escalated) return 'no escalation record';
    if (t.acknowledged_at) return `recorded ${t.acknowledged_at}`;
    if (t.acknowledgement_revoked_at) return `revoked ${t.acknowledgement_revoked_at}`;
    return 'no record';
}

/** A null timing prints n/a with no unit. */
const seconds = (s: number | null) => (s === null ? 'n/a' : `${s}s`);

export function renderProgressReport(r: ProgressReport): string {
    const line = (t: TopicProgress) => `- topic ${t.topic_id} v${t.topic_version} | ${t.stuck_reason ? `${t.stuck_reason}: ${reasonText(t)}` : 'advanced'} | last ${t.last_stage} at ${t.last_at} | queue wait ${seconds(t.queue_wait_s)}, inference ${seconds(t.inference_s)} | alert channel records (all alerts): ${channelRecords(t)} | acknowledged (latest alert): ${acknowledgementRecord(t)} | correlation ${t.correlation_ids.join(',')}`;
    return [`# Judge progress (records only) ${r.generated_at}`, `## Did not advance (${r.did_not_advance.length})`, ...r.did_not_advance.map(line),
        `## In flight (${r.in_flight.length})`, ...r.in_flight.map(line), `## Advanced (${r.advanced.length})`, ...r.advanced.map(line)].join('\n');
}
