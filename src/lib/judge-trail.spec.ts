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

describe('stuck-topic report wording (content-manager review E1 to E9)', () => {
    const render = (events: TrailEvent[]) => renderProgressReport(buildProgressReport(events, now));
    const lineFor = (out: string, topic: string) => out.split('\n').find(l => l.startsWith(`- topic ${topic} `)) ?? '';
    // The stable code escalated_no_channel_delivered is a key, not wording; the banned-word check looks at everything else.
    const prose = (out: string) => out.replace(/escalated_no_channel_delivered/g, '');
    const noBanned = (out: string) => { for (const w of ['no alert', 'delivered', 'finished']) expect(prose(out).toLowerCase()).not.toContain(w); };
    const base = [ev('inference_done', 10, 't1', { exhausted: true }), ev('escalated', 20)];
    const viaDb = [...base, ev('alert_channel', 21, 't1', { channel: 'webhook', outcome: 'skipped' }), ev('alert_channel', 21, 't1', { channel: 'resend', outcome: 'failed' }), ev('alert_channel', 22, 't1', { channel: 'db', outcome: 'sent' })];

    it('viaDb: E5 text naming db, every outcome in the channel field, no acknowledgement (E5 E6 E7 E8)', () => {
        const out = render(viaDb);
        const l = lineFor(out, 't1');
        expect(l).toContain('escalated_unacknowledged: Alert sent on db (send receipt, not proof it was read); no acknowledgement recorded.');
        expect(l).toContain('alert channel records: sent: db; failed: resend; skipped: webhook');
        expect(l).toContain('acknowledged: no record');
        expect(out).not.toContain('alert channels sent:');
        noBanned(out);
    });
    it('only a skipped channel row: E4 text, skipped shown, channel field is not "no record" (E4 E6)', () => {
        const out = render([...base, ev('alert_channel', 21, 't1', { channel: 'webhook', outcome: 'skipped' })]);
        const l = lineFor(out, 't1');
        expect(l).toContain('Alert raised; no channel record says sent (no record is not proof that nothing was sent).');
        expect(l).toContain('alert channel records: skipped: webhook');
        expect(l).not.toContain('alert channel records: no record');
        noBanned(out);
    });
    it('no alert_channel row at all prints "no record" in the channel field (E6)', () => {
        const l = lineFor(render(base), 't1');
        expect(l).toContain('alert channel records: no record');
    });
    it('enqueued and claimed only, older than 30 min: E2 text with last recorded step: claimed (E2)', () => {
        const out = render([ev('enqueued', 0), ev('claimed', 60)]);
        expect(lineFor(out, 't1')).toContain('no_state_change: No state change recorded; last recorded step: claimed.');
        noBanned(out);
    });
    it('exhausted and rejected texts (E1 E3)', () => {
        const ex = lineFor(render([ev('enqueued', 0), ev('inference_done', 100, 't1', { exhausted: true })]), 't1');
        expect(ex).toContain('judge_exhausted: Judge job recorded as exhausted after its bounded attempts (max 3); needs human review.');
        const rj = render([ev('inference_done', 100), ev('validated', 101, 't1', { ok: false })]);
        expect(lineFor(rj, 't1')).toContain('judge_rejected: Judge rejected the claims (validation failed); no state change recorded since.');
        noBanned(rj);
    });
    it('an acknowledged topic prints acknowledged: recorded <at> (E7)', () => {
        const l = lineFor(render([...viaDb, ev('acknowledged', 30)]), 't1');
        expect(l).toContain(`acknowledged: recorded ${at(30)}`);
        expect(l).not.toContain('acknowledged: no record');
    });
    it('oldest last_at first in every section, ties by topic then version (E9)', () => {
        // first-seen order is c, a, b; last_at order is a (100), b (100, ties after a), c (900)
        const out = render([ev('claimed', 900, 'c'), ev('claimed', 100, 'a'), ev('claimed', 100, 'b')]);
        expect(out.indexOf('- topic a ')).toBeLessThan(out.indexOf('- topic b '));
        expect(out.indexOf('- topic b ')).toBeLessThan(out.indexOf('- topic c '));
        const v = (topic: string, version: string, s: number): TrailEvent => ({ ...ev('claimed', s, topic), topic_version: version });
        const ties = render([v('a', 'v2', 100), v('a', 'v1', 100)]);
        expect(ties.indexOf('topic a vv1 ')).toBeLessThan(ties.indexOf('topic a vv2 '));
        const adv = render([ev('state_changed', 500, 'late', { advanced: true }), ev('state_changed', 50, 'early', { advanced: true })]);
        expect(adv.indexOf('- topic early ')).toBeLessThan(adv.indexOf('- topic late '));
        const fresh = render([ev('enqueued', 3 * 3600 - 10, 'newer'), ev('enqueued', 3 * 3600 - 60, 'older')]);
        expect(fresh.indexOf('- topic older ')).toBeLessThan(fresh.indexOf('- topic newer '));
    });
});

describe('recordTrail', () => {
    it('swallows a database failure and never throws', async () => {
        const client = { from: () => ({ insert: vi.fn().mockRejectedValue(new Error('down')) }) };
        await expect(recordTrail(client, { correlation_id: 'c', stage: 'enqueued', topic_id: 't', topic_version: 'v' })).resolves.toBe(false);
    });
});
