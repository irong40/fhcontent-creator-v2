import { describe, expect, it } from 'vitest';
import { buildProgressReport, type TrailEvent } from './judge-trail';

// HR-7 rework r3: ack and delivery belong to the latest escalation by exact error id, never by a time
// window. Pure helper, explicit records; A is an older error, B the later one on the same topic+version.
const T = (s: number) => `2026-10-22T10:00:${String(s).padStart(2, '0')}.000Z`;
const row = (stage: TrailEvent['stage'], s: number, detail?: Record<string, unknown>, version = 'v1'): TrailEvent =>
    ({ correlation_id: `c-${version}`, stage, topic_id: 't1', topic_version: version, at: T(s), detail });
const escA = row('escalated', 0, { reason: 'retries_exhausted', error_id: 'A' });
const sentA = row('alert_channel', 1, { channel: 'db', outcome: 'sent', error_id: 'A' });
const ackA = row('acknowledged', 2, { error_id: 'A' });
const escB = row('escalated', 3, { reason: 'retries_exhausted', error_id: 'B' });
const sentB = row('alert_channel', 4, { channel: 'db', outcome: 'sent', error_id: 'B' });
const lateA = row('alert_channel', 5, { channel: 'resend', outcome: 'sent', error_id: 'A' }); // delayed A receipt after B escalated
const now = new Date('2099-01-01T00:00:00Z');
const report = (events: TrailEvent[], version = 'v1') =>
    [...buildProgressReport(events, now).did_not_advance, ...buildProgressReport(events, now).advanced].find(t => t.topic_version === version)!;

describe('ack ownership by exact error identity (rework r3)', () => {
    it('1 a delayed A receipt after B escalated: B stays unacknowledged, ack null', () => {
        const t = report([escA, sentA, ackA, escB, sentB, lateA]);
        expect(t.stuck_reason).toBe('escalated_unacknowledged');
        expect(t.acknowledged_at).toBeNull();
        expect(t.escalation_channels_sent).toEqual(['db']);
    });
    it('1b a delayed A sent row does not count as delivery for B', () => {
        const failedB = row('alert_channel', 4, { channel: 'db', outcome: 'failed', error_id: 'B' });
        const t = report([escA, sentA, ackA, escB, failedB, lateA]);
        expect(t.stuck_reason).toBe('escalated_no_channel_delivered');
        expect(t.escalation_channels_sent).toEqual([]);
        expect(t.acknowledged_at).toBeNull();
    });
    it('2 B acked: acknowledged_at is B\'s own ack time, not A\'s', () => {
        const t = report([escA, sentA, ackA, escB, sentB, lateA, row('acknowledged', 6, { error_id: 'B' })]);
        expect(t.stuck_reason).toBe('no_state_change');
        expect(t.acknowledged_at).toBe(T(6));
    });
    it('3 revoke B reopens it; re-ack B closes it at the re-ack time', () => {
        const base = [escA, sentA, ackA, escB, sentB, lateA, row('acknowledged', 6, { error_id: 'B' }), row('acknowledged', 7, { error_id: 'B', revoked: true })];
        const revoked = report(base);
        expect(revoked.stuck_reason).toBe('escalated_unacknowledged');
        expect(revoked.acknowledged_at).toBeNull();
        const reacked = report([...base, row('acknowledged', 8, { error_id: 'B' })]);
        expect(reacked.stuck_reason).toBe('no_state_change');
        expect(reacked.acknowledged_at).toBe(T(8));
    });
    it('4 acks and channel rows do not cross topic versions', () => {
        const v2 = [row('escalated', 3, { error_id: 'B2' }, 'v2'), row('alert_channel', 4, { channel: 'db', outcome: 'sent', error_id: 'B2' }, 'v2')];
        // v1 rows with the v2 error id (a mis-joined write) never reach v2: rows are grouped by topic+version first.
        const crossed = [row('alert_channel', 5, { channel: 'resend', outcome: 'sent', error_id: 'B2' }), row('acknowledged', 6, { error_id: 'B2' })];
        const t2 = report([escA, sentA, ackA, ...crossed, ...v2], 'v2');
        expect(t2.stuck_reason).toBe('escalated_unacknowledged');
        expect(t2.acknowledged_at).toBeNull();
        expect(t2.escalation_channels_sent).toEqual(['db']);
        const t1 = report([escA, sentA, ackA, ...crossed, ...v2], 'v1');
        expect(t1.acknowledged_at).toBe(T(2)); // v1's own A ack stays A's
    });
    it('5a escalation with no error_id never reads acknowledged or delivered (fail closed)', () => {
        const bare = row('escalated', 3, { reason: 'retries_exhausted' });
        const t = report([escA, sentA, ackA, bare, row('alert_channel', 4, { channel: 'db', outcome: 'sent' }), lateA, row('acknowledged', 6, { error_id: 'A' })]);
        expect(t.stuck_reason).toBe('escalated_no_channel_delivered');
        expect(t.acknowledged_at).toBeNull();
        const empty = report([row('escalated', 3, { error_id: '' }), row('alert_channel', 4, { channel: 'db', outcome: 'sent', error_id: '' }), row('acknowledged', 6, { error_id: '' })]);
        expect(empty.acknowledged_at).toBeNull();
        expect(empty.stuck_reason).toBe('escalated_no_channel_delivered');
    });
    it('5b an ack with no error_id never closes B', () => {
        const t = report([escA, sentA, ackA, escB, sentB, row('acknowledged', 6), row('acknowledged', 7, {})]);
        expect(t.stuck_reason).toBe('escalated_unacknowledged');
        expect(t.acknowledged_at).toBeNull();
    });
});
