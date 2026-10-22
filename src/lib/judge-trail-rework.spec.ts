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

describe('R1 point 1: queue wait reaches the report; inference_done is the job finish time', () => {
    it('writes enqueued at the job created_at, and the report prints the 1525 s wait', async () => {
        await expect(ask('piece 1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        expect(trail().map(e => [e.stage, e.at])).toEqual([['enqueued', '2026-10-22T10:00:00.000Z']]);
        finish(job(), 'succeeded');
        await ask('piece 1');
        const done = trail().find(e => e.stage === 'inference_done')!;
        expect(done.at).toBe('2026-10-22T10:27:00.000Z');
        const t = buildProgressReport(trail(), new Date('2026-10-22T10:28:00Z')).in_flight[0];
        expect(t.queue_wait_s).toBe(1525);
        expect(t.inference_s).toBe(95);
        expect(renderProgressReport(buildProgressReport(trail(), new Date('2026-10-22T10:28:00Z')))).toContain('queue wait 1525s, inference 95s');
    });
    it('falls back to claimed.detail.queue_wait_ms when the enqueued row is missing', () => {
        const cid = topicCorrelationId('t1', 'v1');
        const r = buildProgressReport([
            { correlation_id: cid, stage: 'claimed', topic_id: 't1', topic_version: 'v1', at: '2026-10-22T10:25:25Z', detail: { queue_wait_ms: 1525000 } },
        ], new Date('2026-10-22T10:26:00Z'));
        expect(r.in_flight[0].queue_wait_s).toBe(1525);
    });
});

describe('R1 point 2: one topic/version carries one correlation id through every stage', () => {
    it('queue rows, two judged pieces, held state, escalation, alert channels and ack share one id', async () => {
        for (const piece of ['piece 1', 'piece 2']) await expect(ask(piece)).rejects.toBeInstanceOf(LocalInferencePendingError);
        for (const j of db.tables.local_inference_jobs) finish(j, 'failed');
        for (const piece of ['piece 1', 'piece 2']) await expect(ask(piece)).rejects.toThrow(/exhausted/);
        const cid = topicCorrelationId('t1', 'v1');
        // The content-generator writes these with the same helper (route.ts held/escalated path).
        db.tables.judge_trail.push({ correlation_id: cid, stage: 'escalated', topic_id: 't1', topic_version: 'v1', at: '2026-10-22T10:30:00.000Z' });
        await notifyError({ source: 'content-generator', message: 'm', topicId: 't1', trail: { correlationId: cid, topicVersion: 'v1' } });
        await ack((db.tables.errors[0].id as string));
        const r = buildProgressReport(trail(), new Date('2026-10-22T12:00:00Z'));
        const all = [...r.did_not_advance, ...r.advanced, ...r.in_flight];
        expect(all).toHaveLength(1);
        expect(all[0].correlation_ids).toEqual([cid]);
        expect(new Set(trail().map(e => e.stage))).toEqual(new Set(['enqueued', 'inference_done', 'escalated', 'alert_channel', 'acknowledged']));
        // The request key survives on the queue rows; the job row carries the topic id too.
        expect(new Set(trail().filter(e => e.stage === 'enqueued').map(e => e.detail?.request_key)).size).toBe(2);
        expect(db.tables.local_inference_jobs.every(j => j.correlation_id === cid)).toBe(true);
    });
});

describe('R1 point 3: a queued job is in the report; repeat reads and retries write nothing new', () => {
    it('a topic waiting in the queue reports did_not_advance after 30 min with last step enqueued', async () => {
        await expect(ask('piece 1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        await expect(ask('piece 1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        expect(trail()).toHaveLength(1);
        const r = buildProgressReport(trail(), new Date('2026-10-22T10:45:00Z'));
        expect(r.did_not_advance.map(t => [t.topic_id, t.last_stage, t.stuck_reason])).toEqual([['t1', 'enqueued', 'no_state_change']]);
    });
    it('cached reads of a finished job and retries of an exhausted job keep the rows and last_at', async () => {
        await expect(ask('piece 1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        finish(job(), 'succeeded');
        for (let i = 0; i < 3; i++) await ask('piece 1');
        expect(trail().map(e => e.stage)).toEqual(['enqueued', 'claimed', 'inference_done']);
        await expect(ask('piece 9', 't2')).rejects.toBeInstanceOf(LocalInferencePendingError);
        finish(db.tables.local_inference_jobs[1], 'failed');
        for (let i = 0; i < 3; i++) await expect(ask('piece 9', 't2')).rejects.toThrow(/exhausted/);
        const t2 = trail().filter(e => e.topic_id === 't2');
        expect(t2.map(e => e.stage)).toEqual(['enqueued', 'inference_done']);
        expect(buildProgressReport(trail(), new Date('2026-10-22T12:00:00Z')).did_not_advance.find(t => t.topic_id === 't2')!.last_at).toBe('2026-10-22T10:27:00.000Z');
    });
    it('a trail check that fails writes no row rather than a duplicate', async () => {
        failTrail.select = true;
        await expect(ask('piece 1')).rejects.toBeInstanceOf(LocalInferencePendingError);
        expect(trail()).toHaveLength(0);
    });
});

describe('acknowledgement ownership: exact error identity, fail closed', () => {
    const raise = (topicId: string, topicVersion: string) =>
        notifyError({ source: 'content-generator', message: `${topicId}/${topicVersion}`, topicId, trail: { correlationId: topicCorrelationId(topicId, topicVersion), topicVersion } });
    it('acknowledging error A on v1 does not mark B on v2, even though B is the newest alert', async () => {
        await raise('t1', 'v1');
        await raise('t1', 'v2');
        const [a, b] = db.tables.errors;
        expect((await ack(a.id as string)).status).toBe(200);
        const acks = trail().filter(e => e.stage === 'acknowledged');
        expect(acks).toHaveLength(1);
        expect(acks[0]).toMatchObject({ topic_version: 'v1', correlation_id: topicCorrelationId('t1', 'v1'), detail: { error_id: a.id } });
        const r = buildProgressReport(trail(), new Date());
        const v2 = [...r.did_not_advance, ...r.in_flight].find(t => t.topic_version === 'v2')!;
        expect(v2.acknowledged_at).toBeNull();
        expect(acks.some(e => e.detail?.error_id === b.id)).toBe(false);
    });
    it('an error with no trail (no correlation) writes no acknowledged row; no newest-topic guess', async () => {
        await raise('t1', 'v1');
        await notifyError({ source: 'other', message: 'no trail', topicId: 't1' });
        expect((await ack(db.tables.errors[1].id as string)).status).toBe(200);
        expect(trail().filter(e => e.stage === 'acknowledged')).toHaveLength(0);
    });
    it('a repeat acknowledgement writes one row (idempotent)', async () => {
        await raise('t1', 'v1');
        const id = db.tables.errors[0].id as string;
        await ack(id); await ack(id);
        expect(trail().filter(e => e.stage === 'acknowledged')).toHaveLength(1);
    });
    it('a trail write failure does not fail the acknowledge and associates nothing', async () => {
        await raise('t1', 'v1');
        failTrail.insert = true;
        expect((await ack(db.tables.errors[0].id as string)).status).toBe(200);
        expect(db.tables.errors[0].acknowledged).toBe(true);
        expect(trail().filter(e => e.stage === 'acknowledged')).toHaveLength(0);
    });
});
