import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), failSelect: 0, failUpsert: false, updates: 0, afterFirstSelect: null as null | (() => void) }));
vi.mock('./supabase/server', () => ({
    createAdminClient: () => ({ from: () => ({
        select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => {
            if (h.failSelect > 0) { h.failSelect--; return { data: null, error: { code: 'XX' } }; }
            const data = h.rows.get(k) ?? null;
            const hook = h.afterFirstSelect; h.afterFirstSelect = null; hook?.();
            return { data, error: null };
        } }) }),
        upsert: async (row: { request_key: string }) => {
            if (h.failUpsert) return { error: { code: 'XX' } };
            if (!h.rows.has(row.request_key)) h.rows.set(row.request_key, row);
            return { error: null };
        },
        update: (row: { request_key: string }) => ({ eq: () => {
            const apply = (col: string, val: unknown) => { const cur = h.rows.get(row.request_key); if (!cur || cur[col] !== val) return Promise.resolve({ error: null }); h.updates++; h.rows.set(row.request_key, row); return Promise.resolve({ error: null }); };
            return { eq: async (c: string, v: unknown) => apply(c, v), is: async (c: string, v: unknown) => apply(c, v) };
        } }),
    }) }),
}));
import { draftCacheKey, readCachedDraft, writeCachedDraft } from './draft-cache';

const mine = { text: 'mine', inputTokens: 1, outputTokens: 2 };
beforeEach(() => { h.rows.clear(); h.failSelect = 0; h.failUpsert = false; h.updates = 0; h.afterFirstSelect = null; vi.spyOn(console, 'error').mockImplementation(() => {}); });
describe('draft cache', () => {
    it('keys on maxTokens and schema', () => {
        expect(draftCacheKey('a', 's', 'u', 1)).not.toBe(draftCacheKey('a', 's', 'u', 2));
        expect(draftCacheKey('a', 's', 'u', 1)).not.toBe(draftCacheKey('a', 's', 'u', 1, { t: 1 }));
    });
    it('stores a first draft and returns it', async () => {
        expect(await writeCachedDraft('k', mine)).toEqual(mine);
        expect(await readCachedDraft('k')).toEqual(mine);
    });
    it('returns the stored winner when another pass wrote first', async () => {
        await writeCachedDraft('k', { text: 'winner', inputTokens: 3, outputTokens: 4 });
        expect((await writeCachedDraft('k', mine)).text).toBe('winner');
    });
    it('returns the draft in hand, without throwing, when the stored draft cannot be read back', async () => {
        h.failSelect = 1;
        expect(await writeCachedDraft('k', mine)).toEqual(mine);
        expect(h.rows.get('k')).toBeDefined();
    });
    it('replaces an unusable stored row', async () => {
        h.rows.set('k', { request_key: 'k', status: 'succeeded', result_text: '  ', input_tokens: null, output_tokens: null });
        expect(await readCachedDraft('k')).toBeNull();
        expect(await writeCachedDraft('k', mine)).toEqual(mine);
        expect(h.updates).toBe(1);
    });
    it('replaces a null-text stored row', async () => {
        h.rows.set('k', { request_key: 'k', status: 'queued', result_text: null, input_tokens: null, output_tokens: null });
        expect(await writeCachedDraft('k', mine)).toEqual(mine);
        expect(h.updates).toBe(1);
    });
    it('does not overwrite a row another pass repaired between the miss and the repair read', async () => {
        h.rows.set('k', { request_key: 'k', status: 'succeeded', result_text: ' ', input_tokens: 1, output_tokens: 1 });
        h.afterFirstSelect = () => h.rows.set('k', { request_key: 'k', status: 'succeeded', result_text: 'other', input_tokens: 5, output_tokens: 6 });
        expect((await writeCachedDraft('k', mine)).text).toBe('other');
        expect(h.updates).toBe(0);
    });
    it('keeps the draft in hand when the write fails', async () => {
        h.failUpsert = true;
        expect(await writeCachedDraft('k', mine)).toEqual(mine);
    });
    it('read surfaces database errors', async () => {
        h.failSelect = 1;
        await expect(readCachedDraft('k')).rejects.toThrow('read failed');
    });
});
