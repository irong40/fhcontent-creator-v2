import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Blotato singleton so the two Blotato-backed steps are unit-testable
// without network. The DB-backed steps take their client as a parameter, so
// they need no module mock — just a hand-rolled fake.
vi.mock('@/lib/blotato', () => ({
    blotato: {
        listTopPosts: vi.fn(),
        getPostStatus: vi.fn(),
    },
}));

import { blotato } from '@/lib/blotato';
import {
    mapMetrics,
    normalizeUrl,
    resolvePostUrls,
    buildMetricsByUrl,
    snapshotMatchedMetrics,
} from './analytics-pull';

const listTopPosts = vi.mocked(blotato.listTopPosts);
const getPostStatus = vi.mocked(blotato.getPostStatus);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('mapMetrics', () => {
    it('coerces Blotato string metric values to numbers', () => {
        // Blotato returns every metric as a string (counts can exceed JS
        // number precision). The old typeof==='number' guard zeroed these.
        expect(mapMetrics({ viewsCount: '1049', likesCount: '3', commentsCount: '0', sharesCount: '0' }))
            .toEqual({ views: 1049, likes: 3, comments: 0, shares: 0, saves: 0 });
    });

    it('still accepts numeric values', () => {
        expect(mapMetrics({ viewsCount: 42, likesCount: 5 }))
            .toEqual({ views: 42, likes: 5, comments: 0, shares: 0, saves: 0 });
    });

    it('falls back across platform-specific view fields', () => {
        expect(mapMetrics({ playsCount: '200' }).views).toBe(200);       // IG reels
        expect(mapMetrics({ impressionsCount: '77' }).views).toBe(77);   // Twitter/Threads
    });

    it('sums cross-platform share/repost variants', () => {
        expect(mapMetrics({ sharesCount: '1', twitterRetweetsCount: '2', threadsRepostsCount: '3' }).shares)
            .toBe(6);
    });

    it('treats junk / empty metrics as zero, never NaN', () => {
        const m = mapMetrics({ viewsCount: 'not-a-number', likesCount: null, commentsCount: undefined });
        expect(m.views).toBe(0);
        expect(Number.isNaN(m.views)).toBe(false);
        expect(m).toEqual({ views: 0, likes: 0, comments: 0, shares: 0, saves: 0 });
    });
});

describe('normalizeUrl', () => {
    it('joins the two id spaces despite www/scheme/slash differences', () => {
        // getPostStatus publicUrl vs listTopPosts postUrl for the same post.
        expect(normalizeUrl('https://www.tiktok.com/@x/video/123'))
            .toBe(normalizeUrl('http://tiktok.com/@x/video/123/'));
    });

    it('strips query and hash', () => {
        expect(normalizeUrl('https://facebook.com/reel/964325996639054/?ref=share#top'))
            .toBe('facebook.com/reel/964325996639054');
    });

    it('is empty for null/undefined', () => {
        expect(normalizeUrl(null)).toBe('');
        expect(normalizeUrl(undefined)).toBe('');
    });
});

describe('buildMetricsByUrl', () => {
    it('indexes latest metrics by normalized url and dedups across sort keys', async () => {
        listTopPosts.mockResolvedValue({
            items: [{
                id: 'a', content: '', platform: 'tiktok', createdAt: '', mediaUrls: [],
                postUrl: 'https://www.tiktok.com/@x/video/1',
                latestMetrics: { fetchedAt: 't', metrics: { viewsCount: '5' } },
            }],
        });

        const map = await buildMetricsByUrl('2026-01-01T00:00:00Z');

        // Same item returned for all 4 sort keys → one entry, keyed normalized.
        expect(map.size).toBe(1);
        expect(map.get('tiktok.com/@x/video/1')).toEqual({ viewsCount: '5' });
    });

    it('keeps going when one sort key throws', async () => {
        listTopPosts
            .mockRejectedValueOnce(new Error('boom'))            // views_count fails
            .mockResolvedValue({
                items: [{
                    id: 'b', content: '', platform: 'twitter', createdAt: '', mediaUrls: [],
                    postUrl: 'https://twitter.com/x/status/2',
                    latestMetrics: { fetchedAt: 't', metrics: { impressionsCount: '9' } },
                }],
            });

        const map = await buildMetricsByUrl('2026-01-01T00:00:00Z');
        expect(map.get('twitter.com/x/status/2')).toEqual({ impressionsCount: '9' });
    });
});

describe('resolvePostUrls', () => {
    function fakeClient() {
        const updated: string[] = [];
        const supabase = {
            from: () => ({
                update: () => ({ eq: (_c: string, id: string) => { updated.push(id); return Promise.resolve({ error: null }); } }),
            }),
        };
        return { supabase: supabase as never, updated };
    }

    it('resolves and caches a missing post_url, persisting the piece', async () => {
        getPostStatus.mockResolvedValue({ id: 's1', status: 'published', createdAt: '', publicUrl: 'https://www.tiktok.com/@x/video/9' });
        const piece = { id: 'p1', published_platforms: { tiktok: { status: 'published', post_id: 'sub1' } } } as never;
        const { supabase } = fakeClient();

        const res = await resolvePostUrls(supabase, [piece]);

        expect(res).toEqual({ urlsResolved: 1, urlResolutionErrors: 0 });
        expect((piece as { published_platforms: { tiktok: { post_url?: string } } }).published_platforms.tiktok.post_url)
            .toBe('https://www.tiktok.com/@x/video/9');
    });

    it('skips entries that already have a url or are not published, and counts errors', async () => {
        getPostStatus.mockRejectedValue(new Error('404'));
        const pieces = [{
            id: 'p1',
            published_platforms: {
                tiktok: { status: 'published', post_id: 'sub1', post_url: 'https://done/1' }, // already resolved → skip
                twitter: { status: 'failed', post_id: 'sub2' },                                // not published → skip
                youtube: { status: 'published', post_id: 'sub3' },                             // resolves → getPostStatus throws
            },
        }] as never[];
        const { supabase } = fakeClient();

        const res = await resolvePostUrls(supabase, pieces);
        expect(res).toEqual({ urlsResolved: 0, urlResolutionErrors: 1 });
    });
});

describe('snapshotMatchedMetrics', () => {
    function fakeClient() {
        const inserts: Array<Record<string, unknown>> = [];
        const supabase = {
            from: () => ({ insert: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: null }); } }),
        };
        return { supabase: supabase as never, inserts };
    }

    it('inserts a snapshot for matched posts, and buckets no-signal and unmatched', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: {
                tiktok: { status: 'published', post_url: 'https://www.tiktok.com/@x/video/1' },  // matched, has signal
                twitter: { status: 'published', post_url: 'https://twitter.com/x/status/2' },     // matched, zero signal
                youtube: { status: 'published', post_url: 'https://youtube.com/watch?v=zzz' },    // unmatched
            },
        }] as never[];
        const metricsByUrl = new Map<string, Record<string, string>>([
            [normalizeUrl('https://www.tiktok.com/@x/video/1'), { viewsCount: '100', likesCount: '4' }],
            [normalizeUrl('https://twitter.com/x/status/2'), { viewsCount: '0', likesCount: '0' }],
        ]);
        const { supabase, inserts } = fakeClient();

        const res = await snapshotMatchedMetrics(supabase, pieces, metricsByUrl as never);

        expect(res.snapshots).toBe(1);
        expect(res.matchedNoSignal).toBe(1);
        expect(res.unmatched).toBe(1);
        expect(res.sampleUnmatchedUrl).toBe('https://youtube.com/watch?v=zzz');
        expect(inserts).toEqual([
            { content_piece_id: 'p1', platform: 'tiktok', views: 100, likes: 4, comments: 0, shares: 0, saves: 0 },
        ]);
    });

    it('records insert failures with a sample message', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: { tiktok: { status: 'published', post_url: 'https://www.tiktok.com/@x/video/1' } },
        }] as never[];
        const metricsByUrl = new Map([[normalizeUrl('https://www.tiktok.com/@x/video/1'), { viewsCount: '100' }]]);
        const supabase = {
            from: () => ({ insert: () => Promise.resolve({ error: { message: 'permission denied' } }) }),
        } as never;

        const res = await snapshotMatchedMetrics(supabase, pieces, metricsByUrl as never);
        expect(res.snapshots).toBe(0);
        expect(res.insertErrors).toBe(1);
        expect(res.sampleInsertError).toBe('permission denied');
    });
});
