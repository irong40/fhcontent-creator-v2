import { afterEach, describe, expect, it, vi } from 'vitest';

// An in-memory content_draft_holds table behind the admin client.
const table = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, fail: false as false | 'error' | 'throw' }));
vi.mock('./supabase/server', () => ({ createAdminClient: () => ({ from: () => {
    if (table.fail === 'throw') throw new Error('relation "content_draft_holds" does not exist');
    const err = table.fail === 'error' ? { code: '42P01' } : null;
    let filter: [string, unknown] | null = null;
    let op: 'select' | 'delete' = 'select';
    const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filter = [col, val]; return chain; },
        maybeSingle: async () => ({ data: err ? null : table.rows.find(r => filter && r[filter[0]] === filter[1]) ?? null, error: err }),
        upsert: async (row: Record<string, unknown>) => {
            if (!err && !table.rows.some(r => r.request_key === row.request_key)) table.rows.push(row);
            return { error: err };
        },
        delete: () => { op = 'delete'; return chain; },
        then: (resolve: (v: unknown) => unknown) => {
            if (op === 'delete' && !err && filter) table.rows = table.rows.filter(r => r[filter![0]] !== filter![1]);
            return Promise.resolve({ error: err }).then(resolve);
        },
    };
    return chain;
} }) }));
import { holdDraft, holdKey, readHeldDraft, releaseDraftHolds } from './draft-hold';

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
});
