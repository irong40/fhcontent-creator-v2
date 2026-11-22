import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/blotato', () => ({ blotato: {} }));

import { planLinks, applyLinkChanges } from './nec-tiktok-link-backfill';
import { loadTikTokPieceLinks } from '@/lib/analytics-pull';
import { buildNecLinkIndex } from '@/lib/nec-tiktok-link';

// Fixture rows only.
const V1 = '7663140126465281294';
const V2 = '7663140126465281295';
const u = (id: string) => `https://www.tiktok.com/@northeastcorner1/video/${id}`;
const index = buildNecLinkIndex([
    { clipId: 'NEC-B10-01', submissionId: 's1', publicUrl: u(V1) },
    { clipId: 'NEC-B11-01', submissionId: 's2', publicUrl: u(V2) },
    { clipId: 'NEC-B11-02', submissionId: 's3', publicUrl: u(V2) },
]);

describe('planLinks', () => {
    it('links every capture of a post found through Blotato, refuses ambiguous, explains missing URL, skips linked rows', () => {
        const rows = [
            { id: 'r1', blotato_post_id: '100', video_id: null, post_url: null },
            { id: 'r2', blotato_post_id: '100', video_id: null, post_url: null },
            { id: 'r3', blotato_post_id: null, video_id: V1, post_url: u(V1) },
            { id: 'r4', blotato_post_id: '200', video_id: null, post_url: null },
            { id: 'r5', blotato_post_id: '300', video_id: null, post_url: null },
            { id: 'r6', blotato_post_id: '400', video_id: null, post_url: null, piece_key: 'NEC-B10-01' },
        ];
        const urls = new Map([['100', u(V1)], ['200', u(V2)]]);
        const { posts, changes } = planLinks(rows, urls, index);

        // r1 and r2 have no video_id, so the matched id is filled; r3 keeps its own.
        expect(changes).toEqual([
            { id: 'r1', piece_key: 'NEC-B10-01', video_id: V1 },
            { id: 'r2', piece_key: 'NEC-B10-01', video_id: V1 },
            { id: 'r3', piece_key: 'NEC-B10-01' },
        ]);
        const byKey = Object.fromEntries(posts.map((p) => [p.postKey, p]));
        expect(byKey['200'].result.status).toBe('refused');
        expect(byKey['300'].result).toMatchObject({ status: 'unlinked', reason: expect.stringMatching(/no URL for post 300/) });
        expect(byKey['400']).toBeUndefined();
    });
});

import { withRateLimit } from './nec-tiktok-link-backfill';
describe('withRateLimit', () => {
    it('retries a 429 after the named wait and gives up on other errors', async () => {
        let n = 0;
        const ok = await withRateLimit(async () => { n++; if (n === 1) throw new Error('Blotato API error (429): retry in 0 seconds'); return 'x'; }, 0);
        expect(ok).toBe('x');
        await expect(withRateLimit(async () => { throw new Error('Blotato API error (500)'); }, 0)).rejects.toThrow('(500)');
    }, 10000);
});

describe('applyLinkChanges', () => {
    // Fake table: update().in().is(field, null) changes only listed rows whose field is null.
    function table(rows: Array<Record<string, unknown>>) {
        const writes: Array<{ value: Record<string, unknown>; ids: string[]; nullField: string }> = [];
        const supabase = {
            from: () => ({
                update: (value: Record<string, unknown>) => ({
                    in: (_c: string, ids: string[]) => ({
                        is: (nullField: string) => ({
                            select: async () => {
                                writes.push({ value, ids, nullField });
                                const hit = rows.filter((r) => ids.includes(r.id as string) && r[nullField] == null);
                                for (const r of hit) Object.assign(r, value);
                                return { data: hit.map((r) => ({ id: r.id as string })), error: null };
                            },
                        }),
                    }),
                }),
                // read path used by the carry check below
                select: () => {
                    const q = {
                        eq: () => q, not: () => q, order: () => q,
                        limit: async () => ({ data: rows.filter((r) => r.platform === 'tiktok' && r.piece_key != null && r.video_id != null), error: null }),
                    };
                    return q;
                },
            }),
        };
        return { supabase, writes };
    }

    it('fills piece_key and the missing video_id only where null, so the collector can carry the link', async () => {
        const rows: Array<Record<string, unknown>> = [
            { id: 'r1', platform: 'tiktok', video_id: null, piece_key: null },
            { id: 'r2', platform: 'tiktok', video_id: V1, piece_key: null },
            { id: 'r3', platform: 'tiktok', video_id: null, piece_key: 'NEC-OLD' },
        ];
        const { supabase, writes } = table(rows);

        const done = await applyLinkChanges(supabase as never, [
            { id: 'r1', piece_key: 'NEC-B10-01', video_id: V1 },
            { id: 'r2', piece_key: 'NEC-B10-01' },
            { id: 'r3', piece_key: 'NEC-B10-01', video_id: V1 },
        ]);

        expect(writes).toEqual([
            { value: { piece_key: 'NEC-B10-01' }, ids: ['r1', 'r2', 'r3'], nullField: 'piece_key' },
            { value: { video_id: V1 }, ids: ['r1', 'r3'], nullField: 'video_id' },
        ]);
        expect(done).toEqual({ pieceKeys: 2, videoIds: 2 });
        expect(rows).toEqual([
            { id: 'r1', platform: 'tiktok', video_id: V1, piece_key: 'NEC-B10-01' },
            { id: 'r2', platform: 'tiktok', video_id: V1, piece_key: 'NEC-B10-01' },
            { id: 'r3', platform: 'tiktok', video_id: V1, piece_key: 'NEC-OLD' }, // set key never overwritten
        ]);
        // Backfill run before any new pull: the collector's loader now finds the link.
        expect((await loadTikTokPieceLinks(supabase as never)).get(V1)).toBeDefined();
    });

    it('stops with the field and value named when a write fails', async () => {
        const supabase = {
            from: () => ({ update: () => ({ in: () => ({ is: () => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) }),
        };
        await expect(applyLinkChanges(supabase as never, [{ id: 'r1', piece_key: 'NEC-B10-01', video_id: V1 }])).rejects.toThrow(/piece_key update for NEC-B10-01 failed.*boom/);
    });
});
