import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/blotato', () => ({ blotato: {} }));

import { planLinks } from './nec-tiktok-link-backfill';
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

        expect(changes).toEqual([
            { id: 'r1', piece_key: 'NEC-B10-01' },
            { id: 'r2', piece_key: 'NEC-B10-01' },
            { id: 'r3', piece_key: 'NEC-B10-01' },
        ]);
        const byKey = Object.fromEntries(posts.map((p) => [p.postKey, p]));
        expect(byKey['200'].result.status).toBe('refused');
        expect(byKey['300'].result).toMatchObject({ status: 'unlinked', reason: expect.stringMatching(/no URL for post 300/) });
        expect(byKey['400']).toBeUndefined();
    });
});
