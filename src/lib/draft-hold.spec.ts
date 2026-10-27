import { afterEach, describe, expect, it, vi } from 'vitest';

// An in-memory content_draft_holds table behind the admin client.
const table = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: false as false | 'error' | 'throw' }));
vi.mock('./supabase/server', () => ({ createAdminClient: () => ({ from: () => {
    if (table.fail === 'throw') throw new Error('relation "content_draft_holds" does not exist');
    const err = table.fail === 'error' ? { code: '42P01', message: 'relation "content_draft_holds" does not exist' } : null;
    const filters: Array<[string, unknown]> = [];
    const matches = (r: Record<string, unknown>) => filters.length > 0 && filters.every(([c, v]) => r[c] === v);
    let op: 'select' | 'delete' = 'select';
    const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters.push([col, val]); return chain; },
        maybeSingle: async () => ({ data: err ? null : table.rows.find(matches) ?? null, error: err }),
        // ignoreDuplicates: ON CONFLICT DO NOTHING, as Postgres does it.
        upsert: async (row: Record<string, unknown>) => {
            if (!err && !table.rows.some(r => r.request_key === row.request_key)) table.rows.push({ ...row, created_at: new Date().toISOString() });
            return { error: err };
        },
        delete: () => { op = 'delete'; return chain; },
        then: (resolve: (v: unknown) => unknown) => {
            if (op === 'delete' && !err) table.rows = table.rows.filter(r => !matches(r));
            return Promise.resolve({ error: err }).then(resolve);
        },
    };
    return chain;
} }) }));
import { HOLD_MAX_AGE_MS, holdDraft, holdKey, readHeldDraft, releaseDraftHolds } from './draft-hold';

const request = { requestKey: 'content:t1:pieces:0', system: 'system', user: 'source', maxTokens: 8192 };
const draft = { text: '{"pieces":[]}', inputTokens: 900, outputTokens: 1200 };
afterEach(() => { table.rows = []; table.fail = false; vi.restoreAllMocks(); });

describe('draft holds (2026-10-22)', () => {
    it('gives one key per exact request: a new retry or a new prompt is a new draft', () => {
        expect(holdKey(request)).toMatch(/^[0-9a-f]{64}$/);
        expect(holdKey(request)).toBe(holdKey({ ...request }));
        expect(holdKey({ ...request, requestKey: 'content:t1:pieces:1' })).not.toBe(holdKey(request));
        expect(holdKey({ ...request, user: 'source, rejected once' })).not.toBe(holdKey(request));
    });

    it('returns the held draft on the next read, and nothing once the topic releases it', async () => {
        const key = holdKey(request);
        expect(await readHeldDraft(key)).toBeNull();
        await holdDraft(key, 't1', draft);
        expect(await readHeldDraft(key)).toEqual(draft);
        await releaseDraftHolds('t1');
        expect(await readHeldDraft(key)).toBeNull();
    });

    it('releases only the given topic', async () => {
        await holdDraft(holdKey(request), 't1', draft);
        await holdDraft(holdKey({ ...request, requestKey: 'content:t2:pieces:0' }), 't2', draft);
        await releaseDraftHolds('t1');
        expect(table.rows.map(r => r.topic_id)).toEqual(['t2']);
    });

    it('fails open: with no table, reads give nothing and writes never throw', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const mode of ['error', 'throw'] as const) {
            table.fail = mode;
            expect(await readHeldDraft(holdKey(request))).toBeNull();
            await expect(holdDraft(holdKey(request), 't1', draft)).resolves.toBeUndefined();
            await expect(releaseDraftHolds('t1')).resolves.toBeUndefined();
        }
    });

    // 2026-10-26 (qcheck Q1, Q2, Q4)
    it('logs the code and the message when a read, hold or release fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        table.fail = 'error';
        await readHeldDraft(holdKey(request));
        await holdDraft(holdKey(request), 't1', draft);
        await releaseDraftHolds('t1');
        expect(warn).toHaveBeenCalledTimes(3);
        for (const [line] of warn.mock.calls) expect(line).toContain('42P01 relation "content_draft_holds" does not exist');
        warn.mockClear();
        table.fail = 'throw';
        await readHeldDraft(holdKey(request));
        await holdDraft(holdKey(request), 't1', draft);
        await releaseDraftHolds('t1');
        expect(warn).toHaveBeenCalledTimes(3);
        for (const [line] of warn.mock.calls) expect(line).toContain('does not exist');
    });

    it('ignores a hold older than the cap, so an unfinished judge cannot pin one draft', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const key = holdKey(request);
        table.rows.push({ request_key: key, topic_id: 't1', result_text: draft.text, input_tokens: 1, output_tokens: 2, created_at: new Date(Date.now() - HOLD_MAX_AGE_MS - 60_000).toISOString() });
        expect(await readHeldDraft(key)).toBeNull();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('expired'));
        table.rows.push({ request_key: key, topic_id: 't1', result_text: draft.text, input_tokens: 1, output_tokens: 2, created_at: new Date(Date.now() - 60_000).toISOString() });
        expect(await readHeldDraft(key)).toMatchObject({ text: draft.text });
    });

    // 2026-10-27 (qcheck R1, Codex C1): DO NOTHING on the same key kept the expired row, so
    // every later run bought a fresh draft that was never held.
    it('after a hold expires, the next run holds its new draft and the run after reuses it', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const key = holdKey(request);
        table.rows.push({ request_key: key, topic_id: 't1', result_text: 'old draft', input_tokens: 1, output_tokens: 2, created_at: new Date(Date.now() - HOLD_MAX_AGE_MS - 60_000).toISOString() });
        // Run 1 after expiry: no usable hold, so it buys a draft and holds it.
        expect(await readHeldDraft(key)).toBeNull();
        expect(table.rows).toHaveLength(0);
        const fresh = { text: 'new draft', inputTokens: 10, outputTokens: 20 };
        await holdDraft(key, 't1', fresh);
        // Run 2: reuses that draft instead of buying another.
        expect(await readHeldDraft(key)).toEqual(fresh);
        expect(await readHeldDraft(key)).toEqual(fresh);
        expect(table.rows).toHaveLength(1);
    });

    it('leaves a newer hold in place when dropping an expired one', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const key = holdKey(request);
        const old = new Date(Date.now() - HOLD_MAX_AGE_MS - 60_000).toISOString();
        table.rows.push({ request_key: key, topic_id: 't1', result_text: 'old', input_tokens: 1, output_tokens: 2, created_at: old });
        table.rows.push({ request_key: 'other', topic_id: 't1', result_text: 'other', input_tokens: 1, output_tokens: 2, created_at: old });
        expect(await readHeldDraft(key)).toBeNull();
        expect(table.rows.map(r => r.request_key)).toEqual(['other']);
    });
});
