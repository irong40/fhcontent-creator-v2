import { describe, expect, it, vi } from 'vitest';
import { buildProgressReport, correlationId, recordTrail, renderProgressReport, type TrailEvent } from './judge-trail';

const T0 = Date.parse('2026-10-22T09:00:00Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ev = (stage: TrailEvent['stage'], s: number, topic = 't1', detail?: Record<string, unknown>, corr = 'c1'): TrailEvent =>
    ({ correlation_id: corr, stage, topic_id: topic, topic_version: 'v1', at: at(s), detail });
const now = new Date(T0 + 3 * 3600_000);

describe('correlation id', () => {
    it('is stable across retries and differs per topic version', () => {
        expect(correlationId('t1', 'v1', 'claim:abc')).toBe(correlationId('t1', 'v1', 'claim:abc'));
        expect(correlationId('t1', 'v1', 'claim:abc')).not.toBe(correlationId('t1', 'v2', 'claim:abc'));
    });
});

describe('progress report', () => {
    it('lists a stuck topic whose judge succeeded but state never changed', () => {
        const r = buildProgressReport([ev('enqueued', 0), ev('claimed', 1525), ev('inference_done', 1600), ev('validated', 1601, 't1', { ok: true })], now);
        expect(r.did_not_advance).toHaveLength(1);
        expect(r.did_not_advance[0]).toMatchObject({ topic_id: 't1', stuck_reason: 'no_state_change', queue_wait_s: 1525, inference_s: 75 });
    });
    it('does not list an advanced topic and does not list a fresh one', () => {
        const r = buildProgressReport([ev('state_changed', 10, 'a', { advanced: true }), ev('enqueued', 3 * 3600 - 60, 'b')], now);
        expect(r.advanced.map(t => t.topic_id)).toEqual(['a']);
        expect(r.in_flight.map(t => t.topic_id)).toEqual(['b']);
        expect(r.did_not_advance).toHaveLength(0);
    });
    it('a retried job keeps one correlation id in the row', () => {
        const id = correlationId('t1', 'v1', 'k');
        const r = buildProgressReport([ev('enqueued', 0, 't1', undefined, id), ev('claimed', 5, 't1', undefined, id), ev('claimed', 400, 't1', undefined, id), ev('inference_done', 450, 't1', { exhausted: true }, id)], now);
        expect(r.did_not_advance[0].correlation_ids).toEqual([id]);
        expect(r.did_not_advance[0].stuck_reason).toBe('judge_exhausted');
    });
    it('escalation: webhook silence is not proof; channels come from records', () => {
        const base = [ev('inference_done', 10, 't1', { exhausted: true }), ev('escalated', 20)];
        const none = buildProgressReport(base, now).did_not_advance[0];
        expect(none.stuck_reason).toBe('escalated_no_channel_delivered');
        expect(renderProgressReport(buildProgressReport(base, now))).toContain('no record');
        const viaDb = buildProgressReport([...base, ev('alert_channel', 21, 't1', { channel: 'webhook', outcome: 'skipped' }), ev('alert_channel', 21, 't1', { channel: 'resend', outcome: 'failed' }), ev('alert_channel', 22, 't1', { channel: 'db', outcome: 'sent' })], now).did_not_advance[0];
        expect(viaDb.channels_sent).toEqual(['db']);
        expect(viaDb.channels_failed).toEqual(['resend']);
        expect(viaDb.stuck_reason).toBe('escalated_unacknowledged');
    });
});

describe('recordTrail', () => {
    it('swallows a database failure and never throws', async () => {
        const client = { from: () => ({ insert: vi.fn().mockRejectedValue(new Error('down')) }) };
        await expect(recordTrail(client, { correlation_id: 'c', stage: 'enqueued', topic_id: 't', topic_version: 'v' })).resolves.toBe(false);
    });
});
