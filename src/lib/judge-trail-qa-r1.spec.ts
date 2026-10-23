import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * HR-7 rework round 1 fixtures (QA 2026-10-22 points 1 to 3, plus acknowledgement ownership).
 * One in-memory fake stands in for Supabase: no live database, alert, email or model call.
 */
type Row = Record<string, unknown>;
const { db, sendErrorAlert, failTrail } = vi.hoisted(() => ({
    db: { tables: {} as Record<string, Row[]>, seq: 0 },
    sendErrorAlert: vi.fn(),
    failTrail: { insert: false, select: false },
}));
function field(r: Row, k: string): unknown {
    const m = /^(\w+)->>(\w+)$/.exec(k);
    return m ? (r[m[1]] as Row | undefined)?.[m[2]] : r[k];
}
function fake() {
    const from = (table: string) => {
        const rows = (db.tables[table] ??= []);
        const query = (filters: Array<[string, unknown]> = [], lim = Infinity, desc: string | null = null) => {
            const run = () => {
                if (table === 'judge_trail' && failTrail.select) return { data: null, error: { message: 'down' } };
                const hit = rows.filter(r => filters.every(([k, v]) => field(r, k) === v));
                // Newest first; a same-millisecond tie goes to the later insert, as a real newest-row query could.
                if (desc) hit.sort((a, b) => String(b[desc]).localeCompare(String(a[desc])) || rows.indexOf(b) - rows.indexOf(a));
                return { data: hit.slice(0, lim), error: null };
            };
            const q = {
                eq: (k: string, v: unknown) => query([...filters, [k, v]], lim, desc),
                order: (k: string, o?: { ascending?: boolean }) => query(filters, lim, o?.ascending === false ? k : null),
                limit: (n: number) => query(filters, n, desc),
                single: async () => { const { data } = run(); return data?.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116' } }; },
                maybeSingle: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error }; },
                then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
            };
            return q;
        };
        const inserted = (row: Row | null, error: unknown = null) => ({
            select: () => ({ maybeSingle: async () => ({ data: row ? { id: row.id } : null, error }), single: async () => ({ data: row, error }) }),
            then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ error }).then(ok, ko),
        });
        return {
            select: () => query(),
            insert: (r: Row) => {
                if (table === 'judge_trail' && failTrail.insert) return inserted(null, { message: 'down' });
                const row = { id: `${table}-${++db.seq}`, ...r };
                rows.push(row);
                return inserted(row);
            },
            upsert: (r: Row) => {
                const fresh = !rows.some(x => x.request_key === r.request_key);
                const row = fresh ? { id: `job-${++db.seq}`, status: 'queued', created_at: '2026-10-22T10:00:00.000Z', ...r } : null;
                if (row) rows.push(row);
                return { select: async () => ({ data: row ? [{ id: row.id, created_at: row.created_at }] : [], error: null }) };
            },
        };
    };
    return { from };
}
vi.mock('@/lib/supabase/server', () => ({
    createAdminClient: () => fake(),
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from: () => ({ update: (u: Row) => ({ eq: (_k: string, id: string) => ({ select: () => ({ single: async () => {
            const e = (db.tables.errors ?? []).find(x => x.id === id);
            if (!e) return { data: null, error: { message: 'missing' } };
            Object.assign(e, u);
            return { data: e, error: null };
        } }) }) }) }),
    }),
}));
vi.mock('@/lib/email', () => ({ sendErrorAlert }));

import { buildProgressReport, renderProgressReport, topicCorrelationId, type TrailEvent } from './judge-trail';
import { getOrEnqueueLocalInference, LocalInferencePendingError } from './local-inference-queue';
import { notifyError } from './notifications';
import { PATCH } from '@/app/api/errors/[id]/route';

const trail = () => (db.tables.judge_trail ?? []) as unknown as TrailEvent[];
const job = (key?: string) => (db.tables.local_inference_jobs ?? []).find(j => !key || j.request_key === key)!;
const ask = (user: string, topicId = 't1', topicVersion = 'v1') =>
    getOrEnqueueLocalInference({ requestKey: 'judge', system: 'Judge claims', user, maxTokens: 100, trace: { topicId, topicVersion } });
const finish = (j: Row, status: 'succeeded' | 'failed') => Object.assign(j, {
    status, first_claimed_at: '2026-10-22T10:25:25.000Z', updated_at: '2026-10-22T10:27:00.000Z',
    ...(status === 'succeeded' ? { result_text: 'ok', input_tokens: 10, output_tokens: 5 } : {}),
});
const ack = (id: string) => PATCH({ json: async () => ({ acknowledged: true }) } as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
    db.tables = {}; db.seq = 0; failTrail.insert = false; failTrail.select = false;
    vi.clearAllMocks(); delete process.env.N8N_ERROR_WEBHOOK_URL; process.env.NOTIFICATION_EMAIL = 'ops@example.test';
    sendErrorAlert.mockResolvedValue(true);
});

const raise = (topicId: string, topicVersion: string, msg = 'm', errorId?: string) =>
    notifyError({ source: 'content-generator', message: msg, topicId, trail: { correlationId: topicCorrelationId(topicId, topicVersion), topicVersion, errorId } });
// Rework r3: like the generator, the escalated row carries the error id notifyError then inserts under.
const esc = (topicId: string, topicVersion: string, at: string, errorId: string) => {
    db.tables.judge_trail = [...(db.tables.judge_trail ?? []), { correlation_id: topicCorrelationId(topicId, topicVersion), stage: 'escalated', topic_id: topicId, topic_version: topicVersion, at, detail: { reason: 'retries_exhausted', error_id: errorId } }];
    return errorId;
};
describe('QA r1 independent', () => {
    it('QA1 two errors on ONE topic+version: ack of A must not make later unacked escalation B read acknowledged', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-22T10:30:00Z'));
        await raise('t1', 'unversioned', 'A', esc('t1', 'unversioned', '2026-10-22T10:30:00.000Z', 'err-A'));
        vi.setSystemTime(new Date('2026-10-22T10:40:00Z'));
        await ack(db.tables.errors[0].id as string);
        vi.setSystemTime(new Date('2026-10-22T11:30:00Z'));
        await raise('t1', 'unversioned', 'B', esc('t1', 'unversioned', '2026-10-22T11:30:00.000Z', 'err-B'));
        vi.useRealTimers();
        const t = buildProgressReport(trail(), new Date('2026-10-22T12:00:00Z')).did_not_advance[0];
        console.log('QA1', JSON.stringify({ reason: t.stuck_reason, ack: t.acknowledged_at, last: t.last_stage }));
        expect(t.stuck_reason).toBe('escalated_unacknowledged');
    });
    it('QA2 ack of an error whose topic differs from the alert row writes nothing', async () => {
        await raise('t1', 'v1');
        (db.tables.errors[0] as Row).topic_id = 't2';
        await ack(db.tables.errors[0].id as string);
        expect(trail().filter(e => e.stage === 'acknowledged')).toHaveLength(0);
    });
    it('QA3 errors insert fails: alert rows carry no error_id, ack cannot associate (fail closed)', async () => {
        await raise('t1', 'v1');
        const rows = trail().filter(e => e.stage === 'alert_channel');
        console.log('QA3 alert rows error_id', rows.map(r => r.detail?.error_id));
        expect(rows.every(r => r.detail?.error_id === db.tables.errors[0].id)).toBe(true);
    });
    it('QA4 shared request key, second topic arrives while job queued: is topic B visible?', async () => {
        await expect(ask('same', 'A', 'v1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        await expect(ask('same', 'B', 'v1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        console.log('QA4 rows for B', trail().filter(e => e.topic_id === 'B').length);
        finish(job(), 'succeeded'); await ask('same', 'B', 'v1');
        const b = trail().filter(e => e.topic_id === 'B');
        console.log('QA4 B stages after finish', b.map(e => e.stage), 'job cid is A', job().correlation_id === topicCorrelationId('A', 'v1'));
        // Rework r2: B has its OWN enqueued row while the job waits, once, under B's id and the shared job.
        const bEnq = b.filter(e => e.stage === 'enqueued');
        expect(bEnq).toHaveLength(1);
        expect(bEnq[0].correlation_id).toBe(topicCorrelationId('B', 'v1'));
        expect(bEnq[0].job_id).toBe(job().id);
        expect(b.map(e => e.stage)).toEqual(['enqueued', 'claimed', 'inference_done']);
        expect(trail().filter(e => e.topic_id === 'A' && e.stage === 'enqueued')).toHaveLength(1);
    });
    it('QA4b B is in the report (in flight) while the shared job is still queued; a repeat poll writes no second row', async () => {
        await expect(ask('same', 'A', 'v1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        await expect(ask('same', 'B', 'v1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        await expect(ask('same', 'B', 'v1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        expect(trail().filter(e => e.topic_id === 'B')).toHaveLength(1);
        const r = buildProgressReport(trail(), new Date());
        expect([...r.in_flight, ...r.did_not_advance].map(t => t.topic_id).sort()).toEqual(['A', 'B']);
    });
    it('QA5 unack then re-ack writes no second row; report keeps first ack time', async () => {
        await raise('t1', 'v1');
        const id = db.tables.errors[0].id as string;
        await ack(id);
        await PATCH({ json: async () => ({ acknowledged: false }) } as never, { params: Promise.resolve({ id }) });
        console.log('QA5 ack rows after unack', trail().filter(e => e.stage === 'acknowledged').length);
        // Rework r2: un-ack writes a revoked row; the report reads the topic as open again.
        esc('t1', 'v1', '2026-10-22T09:00:00.000Z', id);
        const open = () => buildProgressReport(trail(), new Date('2099-01-01T00:00:00Z')).did_not_advance[0];
        expect(open().stuck_reason).toBe('escalated_unacknowledged');
        expect(open().acknowledged_at).toBeNull();
        // A repeat un-ack writes nothing; a re-ack writes one new row and closes it again.
        await PATCH({ json: async () => ({ acknowledged: false }) } as never, { params: Promise.resolve({ id }) });
        expect(trail().filter(e => e.stage === 'acknowledged')).toHaveLength(2);
        await ack(id); await ack(id);
        const acks = trail().filter(e => e.stage === 'acknowledged');
        expect(acks.map(e => e.detail?.revoked === true)).toEqual([false, true, false]);
        expect(open().stuck_reason).toBe('no_state_change');
        expect(open().acknowledged_at).toBe(acks[2].at);
    });
    it('QA1b ack of B (the latest escalation) closes it; ack of A alone never does', async () => {
        await raise('t1', 'unversioned', 'A', esc('t1', 'unversioned', '2026-10-22T10:30:00.000Z', 'err-A'));
        db.tables.judge_trail.filter(e => e.stage === 'alert_channel').forEach(e => { e.at = '2026-10-22T10:30:01.000Z'; });
        await raise('t1', 'unversioned', 'B', esc('t1', 'unversioned', '2026-10-22T11:30:00.000Z', 'err-B'));
        const [a, b] = db.tables.errors.map(e => e.id as string);
        await ack(a);
        const now = new Date('2099-01-01T00:00:00Z');
        expect(buildProgressReport(trail(), now).did_not_advance[0].stuck_reason).toBe('escalated_unacknowledged');
        await ack(b);
        const t = buildProgressReport(trail(), now).did_not_advance[0];
        expect(t.stuck_reason).toBe('no_state_change');
        expect(t.acknowledged_at).toBe(trail().filter(e => e.stage === 'acknowledged' && e.detail?.error_id === b)[0].at);
    });
    it('QA7 concurrent duplicate trail rows (no unique index) read the same as one row', () => {
        const cid = topicCorrelationId('t1', 'v1');
        const base = { correlation_id: cid, topic_id: 't1', topic_version: 'v1' };
        const rows: TrailEvent[] = [
            { ...base, stage: 'enqueued', job_id: 'j1', at: '2026-10-22T10:00:00.000Z' },
            { ...base, stage: 'claimed', job_id: 'j1', at: '2026-10-22T10:01:00.000Z' },
            { ...base, stage: 'claimed', job_id: 'j1', at: '2026-10-22T10:01:00.000Z' },
            { ...base, stage: 'escalated', at: '2026-10-22T10:30:00.000Z', detail: { error_id: 'e1' } },
            { ...base, stage: 'alert_channel', at: '2026-10-22T10:30:01.000Z', detail: { channel: 'db', outcome: 'sent', error_id: 'e1' } },
            { ...base, stage: 'acknowledged', at: '2026-10-22T10:40:00.000Z', detail: { error_id: 'e1' } },
            { ...base, stage: 'acknowledged', at: '2026-10-22T10:40:00.001Z', detail: { error_id: 'e1' } },
        ];
        const one = buildProgressReport(rows.filter((_, i) => i !== 2 && i !== 6), new Date('2099-01-01T00:00:00Z')).did_not_advance[0];
        const dup = buildProgressReport(rows, new Date('2099-01-01T00:00:00Z')).did_not_advance[0];
        expect(dup.stuck_reason).toBe(one.stuck_reason);
        expect(dup.queue_wait_s).toBe(one.queue_wait_s);
        expect(dup.acknowledged_at).toBe(one.acknowledged_at);
    });
    it('QA6 ack with an id string that matches another error id prefix writes nothing', async () => {
        await raise('t1', 'v1');
        await ack('errors-9');
        expect(trail().filter(e => e.stage === 'acknowledged')).toHaveLength(0);
    });
});
