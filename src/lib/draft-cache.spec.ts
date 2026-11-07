import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), failSelect: 0, failUpsert: false, updates: 0 }));
vi.mock('./supabase/server', () => ({
    createAdminClient: () => ({ from: () => ({
        select: () => ({ eq: (_c: string, k: string) => ({ maybeSingle: async () => {
            if (h.failSelect > 0) { h.failSelect--; return { data: null, error: { code: 'XX' } }; }
            return { data: h.rows.get(k) ?? null, error: null };
        } }) }),
        upsert: async (row: { request_key: string }) => {
            if (h.failUpsert) return { error: { code: 'XX' } };
            if (!h.rows.has(row.request_key)) h.rows.set(row.request_key, row);
            return { error: null };
        },
        update: (row: { request_key: string }) => ({ eq: () => ({ or: async () => { h.updates++; h.rows.set(row.request_key, row); return { error: null }; } }) }),
    }) }),
}));
import { draftCacheKey, readCachedDraft, writeCachedDraft } from './draft-cache';

const mine = { text: 'mine', inputTokens: 1, outputTokens: 2 };
beforeEach(() => { h.rows.clear(); h.failSelect = 0; h.failUpsert = false; h.updates = 0; vi.spyOn(console, 'error').mockImplementation(() => {}); });
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
    it('throws, not a different draft, when the stored draft cannot be read back', async () => {
        h.failSelect = 1;
        await expect(writeCachedDraft('k', mine)).rejects.toThrow('re-read');
        expect(h.rows.get('k')).toBeDefined();
    });
    it('replaces an unusable stored row', async () => {
        h.rows.set('k', { request_key: 'k', status: 'succeeded', result_text: '  ', input_tokens: null, output_tokens: null });
        expect(await readCachedDraft('k')).toBeNull();
        expect(await writeCachedDraft('k', mine)).toEqual(mine);
        expect(h.updates).toBe(1);
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
