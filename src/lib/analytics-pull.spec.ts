import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Blotato singleton so the two Blotato-backed steps are unit-testable
// without network. The DB-backed steps take their client as a parameter, so
// they need no module mock — just a hand-rolled fake.
vi.mock('@/lib/blotato', () => ({
    blotato: {
        listTopPosts: vi.fn(),
        listPublishedPosts: vi.fn(),
        getPostStatus: vi.fn(),
    },
}));

import { blotato } from '@/lib/blotato';
import {
    mapMetrics,
    normalizeUrl,
    handleFromUrl,
    resolvePostUrls,
    buildAnalyticsIndex,
    snapshotMatchedMetrics,
    snapshotUnmatchedAccounts,
    accountKey,
    resolveHandle,
    buildAccountResolver,
} from './analytics-pull';

const listTopPosts = vi.mocked(blotato.listTopPosts);
const getPostStatus = vi.mocked(blotato.getPostStatus);
const listPublishedPosts = vi.mocked(blotato.listPublishedPosts);

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

    // Regression (2026-07-26): stripping the query collapsed every YouTube watch
    // URL onto the key `youtube.com/watch`. The analytics index is a Map, so one
    // arbitrary post won that key and its metrics were attributed to every
    // YouTube piece — all 11 SAI shorts stored post 5321272's 3 views.
    it('keys distinct YouTube watch urls distinctly', () => {
        expect(normalizeUrl('https://www.youtube.com/watch?v=MqrJb0TPh78'))
            .not.toBe(normalizeUrl('https://www.youtube.com/watch?v=DV4H8v2d6nU'));
    });

    it('joins every YouTube url form on the video id', () => {
        const key = 'youtube.com/video/MqrJb0TPh78';
        expect(normalizeUrl('https://www.youtube.com/watch?v=MqrJb0TPh78')).toBe(key);
        expect(normalizeUrl('https://youtu.be/MqrJb0TPh78')).toBe(key);
        expect(normalizeUrl('https://www.youtube.com/shorts/MqrJb0TPh78')).toBe(key);
        expect(normalizeUrl('https://m.youtube.com/watch?v=MqrJb0TPh78&feature=share')).toBe(key);
    });

    it('is empty for null/undefined', () => {
        expect(normalizeUrl(null)).toBe('');
        expect(normalizeUrl(undefined)).toBe('');
    });
});

describe('handleFromUrl', () => {
    it('extracts the @handle from tiktok/threads/twitter urls, normalized', () => {
        expect(handleFromUrl('https://www.tiktok.com/@SentinelAerialInspector/video/1')).toBe('@sentinelaerialinspector');
        expect(handleFromUrl('https://www.threads.net/@faithharmony4045/post/2')).toBe('@faithharmony4045');
        expect(handleFromUrl('https://x.com/APiercea45/status/3')).toBe('@apiercea45');
    });
    it('is null for handle-less platforms', () => {
        expect(handleFromUrl('https://www.youtube.com/watch?v=abc')).toBeNull();
        expect(handleFromUrl('https://facebook.com/reel/999')).toBeNull();
        expect(handleFromUrl(null)).toBeNull();
    });
});

describe('buildAnalyticsIndex', () => {
    it('indexes metrics + platform + id + url by normalized url, dedup across sort keys', async () => {
        listTopPosts.mockResolvedValue({
            items: [{
                id: 'a', content: '', platform: 'tiktok', createdAt: '', mediaUrls: [],
                postUrl: 'https://www.tiktok.com/@x/video/1',
                latestMetrics: { fetchedAt: 't', metrics: { viewsCount: '5' } },
            }],
        });

        const index = await buildAnalyticsIndex('2026-01-01T00:00:00Z');

        expect(index.size).toBe(1);
        expect(index.get('tiktok.com/@x/video/1')).toEqual({
            metrics: { viewsCount: '5' }, platform: 'tiktok', id: 'a', url: 'https://www.tiktok.com/@x/video/1', postedAt: null,
        });
    });

    it('keeps going when one sort key throws', async () => {
        listTopPosts
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue({
                items: [{
                    id: 'b', content: '', platform: 'twitter', createdAt: '', mediaUrls: [],
                    postUrl: 'https://twitter.com/x/status/2',
                    latestMetrics: { fetchedAt: 't', metrics: { impressionsCount: '9' } },
                }],
            });

        const index = await buildAnalyticsIndex('2026-01-01T00:00:00Z');
        expect(index.get('twitter.com/x/status/2')?.metrics).toEqual({ impressionsCount: '9' });
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

    function idx(entries: Array<[string, Record<string, string>, string, string, string?]>) {
        // [url, metrics, platform, blotatoId, postedAt?]
        return new Map(entries.map(([url, metrics, platform, id, postedAt]) => [
            normalizeUrl(url), { metrics, platform, id, url, postedAt: postedAt ?? null },
        ])) as never;
    }

    it('inserts a snapshot (with blotato id) for matched posts, counts zero rows, buckets unmatched, tracks matched urls', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: {
                tiktok: { status: 'published', post_url: 'https://www.tiktok.com/@x/video/1' },  // matched, has signal
                twitter: { status: 'published', post_url: 'https://twitter.com/x/status/2' },     // matched, zero signal
                instagram: { status: 'published', post_url: 'https://instagram.com/reel/zzz' },   // unmatched
            },
        }] as never[];
        const index = idx([
            ['https://www.tiktok.com/@x/video/1', { viewsCount: '100', likesCount: '4' }, 'tiktok', '901'],
            ['https://twitter.com/x/status/2', { viewsCount: '0', likesCount: '0' }, 'twitter', '902'],
        ]);
        const { supabase, inserts } = fakeClient();

        const res = await snapshotMatchedMetrics(supabase, pieces, index);

        expect(res.snapshots).toBe(2);
        expect(res.matchedNoSignal).toBe(1);
        expect(res.unmatched).toBe(1);
        expect(res.sampleUnmatchedUrl).toBe('https://instagram.com/reel/zzz');
        expect(res.matchedUrls.has('tiktok.com/@x/video/1')).toBe(true);
        expect(inserts).toEqual([
            { content_piece_id: 'p1', platform: 'tiktok', blotato_post_id: '901', published_at: null, views: 100, likes: 4, comments: 0, shares: 0, saves: 0 },
            { content_piece_id: 'p1', platform: 'twitter', blotato_post_id: '902', published_at: null, views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
        ]);
    });

    it('writes published_at from Blotato postedAt', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: { tiktok: { status: 'published', post_url: 'https://www.tiktok.com/@x/video/1' } },
        }] as never[];
        const index = idx([['https://www.tiktok.com/@x/video/1', { viewsCount: '100' }, 'tiktok', '901', '2026-09-30T14:05:00.000Z']]);
        const { supabase, inserts } = fakeClient();

        await snapshotMatchedMetrics(supabase, pieces, index);

        expect(inserts[0]).toMatchObject({ published_at: '2026-09-30T14:05:00.000Z' });
    });

    it('keeps a matched post whose every metric is zero', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: { instagram: { status: 'published', post_url: 'https://instagram.com/reel/abc' } },
        }] as never[];
        const index = idx([['https://instagram.com/reel/abc', { viewsCount: '0', likesCount: '0' }, 'instagram', '903']]);
        const { supabase, inserts } = fakeClient();

        const res = await snapshotMatchedMetrics(supabase, pieces, index);

        expect(res.snapshots).toBe(1);
        expect(res.matchedNoSignal).toBe(1);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({ platform: 'instagram', blotato_post_id: '903', views: 0 });
    });

    // Regression (2026-07-26): YouTube belongs to the yt-dlp collector. While
    // Blotato also wrote YouTube rows, its 15:00 UTC cron landed a
    // (platform,content_piece_id) row first and the collector's same-day dedupe
    // then suppressed that video's real 16:30 ET snapshot every single day.
    it('never writes YouTube rows — that platform is owned by the yt-dlp collector', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: {
                youtube: { status: 'published', post_url: 'https://www.youtube.com/watch?v=MqrJb0TPh78' },
                tiktok: { status: 'published', post_url: 'https://www.tiktok.com/@x/video/1' },
            },
        }] as never[];
        // Index deliberately CONTAINS the YouTube post — a match would still be a bug.
        const index = idx([
            ['https://www.youtube.com/watch?v=MqrJb0TPh78', { viewsCount: '3' }, 'youtube', '5321272'],
            ['https://www.tiktok.com/@x/video/1', { viewsCount: '100' }, 'tiktok', '901'],
        ]);
        const { supabase, inserts } = fakeClient();

        const res = await snapshotMatchedMetrics(supabase, pieces, index);

        expect(res.youtubeSkipped).toBe(1);
        expect(res.unmatched).toBe(0);
        expect(inserts).toHaveLength(1);
        expect(inserts[0]).toMatchObject({ platform: 'tiktok' });
    });

    it('records insert failures with a sample message', async () => {
        const pieces = [{
            id: 'p1',
            published_platforms: { tiktok: { status: 'published', post_url: 'https://www.tiktok.com/@x/video/1' } },
        }] as never[];
        const index = idx([['https://www.tiktok.com/@x/video/1', { viewsCount: '100' }, 'tiktok', '901']]);
        const supabase = {
            from: () => ({ insert: () => Promise.resolve({ error: { message: 'permission denied' } }) }),
        } as never;

        const res = await snapshotMatchedMetrics(supabase, pieces, index);
        expect(res.snapshots).toBe(0);
        expect(res.insertErrors).toBe(1);
        expect(res.sampleInsertError).toBe('permission denied');
    });
});

describe('snapshotUnmatchedAccounts', () => {
    it('captures unmatched posts with or without a handle, keeps zero rows, skips matched and YouTube', async () => {
        const inserts: Array<Record<string, unknown>> = [];
        const supabase = {
            from: () => ({ insert: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: null }); } }),
        } as never;
        const entry = (url: string, metrics: Record<string, string>, platform: string, id: string, postedAt: string | null = null) =>
            [normalizeUrl(url), { metrics, platform, id, url, postedAt }] as const;
        const index = new Map([
            // Sentinel TikTok, unmatched, has signal → captured with its handle and date
            entry('https://www.tiktok.com/@sentinelaerialinspector/video/9', { viewsCount: '1049', likesCount: '3' }, 'tiktok', '5410406', '2026-10-01T12:00:00.000Z'),
            // already matched to a content_piece → skipped
            entry('https://www.tiktok.com/@x/video/1', { viewsCount: '100' }, 'tiktok', '901'),
            // youtube belongs to the yt-dlp collector → skipped
            entry('https://www.youtube.com/watch?v=abc', { viewsCount: '832' }, 'youtube', '5277545'),
            // handle but zero signal → kept
            entry('https://www.tiktok.com/@x/video/5', { viewsCount: '0' }, 'tiktok', '905'),
            // instagram / facebook carry no handle in the url → kept with a null handle
            entry('https://www.instagram.com/reel/IGabc/', { playsCount: '40' }, 'instagram', '906'),
            entry('https://www.facebook.com/reel/999', { viewsCount: '0' }, 'facebook', '907'),
        ]) as never;
        const matched = new Set(['tiktok.com/@x/video/1']);

        const res = await snapshotUnmatchedAccounts(supabase, index, matched);

        expect(res).toEqual({ capturedAccounts: 4, insertErrors: 0 });
        const zero = { comments: 0, shares: 0, saves: 0 };
        expect(inserts).toEqual([
            { content_piece_id: null, platform: 'tiktok', handle: '@sentinelaerialinspector', blotato_post_id: '5410406', published_at: '2026-10-01T12:00:00.000Z', views: 1049, likes: 3, ...zero },
            { content_piece_id: null, platform: 'tiktok', handle: '@x', blotato_post_id: '905', published_at: null, views: 0, likes: 0, ...zero },
            { content_piece_id: null, platform: 'instagram', handle: null, blotato_post_id: '906', published_at: null, views: 40, likes: 0, ...zero },
            { content_piece_id: null, platform: 'facebook', handle: null, blotato_post_id: '907', published_at: null, views: 0, likes: 0, ...zero },
        ]);
    });
});

describe('account attribution', () => {
    const handles = new Map([
        ['59689', '@sentinelaerialinspector'],
        ['4346', '@faithharmony4045'],
        ['3684', 'Adam Pierce (pages)'],
        ['3684/1063375450183829', 'The North East Corner (facebook)'],
        ['3684/899526466587385', 'Sentinel Aerial Inspections (facebook)'],
    ]);

    it('keys a page-level post by account/page and everything else by account', () => {
        expect(accountKey({ id: '3684', subaccount: { id: '1063375450183829' } })).toBe('3684/1063375450183829');
        expect(accountKey({ id: '59689', subaccount: null })).toBe('59689');
        expect(accountKey(null)).toBeNull();
    });

    it('lets the page id decide the handle, falling back to the account id', () => {
        expect(resolveHandle('3684/1063375450183829', handles)).toBe('The North East Corner (facebook)');
        expect(resolveHandle('3684/899526466587385', handles)).toBe('Sentinel Aerial Inspections (facebook)');
        expect(resolveHandle('3684/777', handles)).toBe('Adam Pierce (pages)');
        expect(resolveHandle('59689', handles)).toBe('@sentinelaerialinspector');
        expect(resolveHandle('99999', handles)).toBeNull();
        expect(resolveHandle(null, handles)).toBeNull();
    });

    it('buildAccountResolver walks cursors and joins registry handles to post urls', async () => {
        const supabase = {
            from: () => ({ select: () => Promise.resolve({ data: [
                { account_id: '59689', handle: '@sentinelaerialinspector' },
                { account_id: '3684/1063375450183829', handle: 'The North East Corner (facebook)' },
            ], error: null }) }),
        } as never;
        listPublishedPosts
            .mockResolvedValueOnce({ items: [
                { id: '1', account: { id: '59689', subaccount: null }, platform: 'instagram', state: { type: 'published', postUrl: 'https://www.instagram.com/reel/IGabc/' } },
            ], cursor: 'c2' } as never)
            .mockResolvedValueOnce({ items: [
                { id: '2', account: { id: '3684', subaccount: { id: '1063375450183829' } }, platform: 'facebook', state: { type: 'published', postUrl: 'https://facebook.com/reel/42/' } },
            ] } as never);

        const r = await buildAccountResolver(supabase, '2026-08-01T00:00:00Z');

        expect(listPublishedPosts).toHaveBeenCalledTimes(2);
        expect(listPublishedPosts.mock.calls[1][1]).toBe('c2');
        expect(r.keyByUrl.get(normalizeUrl('https://instagram.com/reel/IGabc'))).toBe('59689');
        expect(r.keyByUrl.get(normalizeUrl('https://www.facebook.com/reel/42'))).toBe('3684/1063375450183829');
        expect(r.handles.get('59689')).toBe('@sentinelaerialinspector');
    });

    it('buildAccountResolver returns an empty resolver when Blotato fails', async () => {
        const supabase = { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) } as never;
        listPublishedPosts.mockRejectedValueOnce(new Error('boom'));
        const r = await buildAccountResolver(supabase, '2026-08-01T00:00:00Z');
        expect(r.keyByUrl.size).toBe(0);
    });

    it('snapshotUnmatchedAccounts stores Instagram and Facebook rows under their account handle', async () => {
        const inserts: Array<Record<string, unknown>> = [];
        const supabase = {
            from: () => ({ insert: (row: Record<string, unknown>) => { inserts.push(row); return Promise.resolve({ error: null }); } }),
        } as never;
        const e = (url: string, platform: string, id: string) =>
            [normalizeUrl(url), { metrics: { viewsCount: '5' }, platform, id, url, postedAt: null }] as const;
        const index = new Map([
            e('https://www.instagram.com/reel/A/', 'instagram', '1'),
            e('https://facebook.com/reel/B/', 'facebook', '2'),
            e('https://facebook.com/reel/C/', 'facebook', '3'),
            e('https://www.instagram.com/reel/D/', 'instagram', '4'), // not in /v2/posts
        ]) as never;
        const keyByUrl = new Map([
            [normalizeUrl('https://www.instagram.com/reel/A/'), '59689'],
            [normalizeUrl('https://facebook.com/reel/B/'), '3684/1063375450183829'],
            [normalizeUrl('https://facebook.com/reel/C/'), '3684/899526466587385'],
        ]);

        await snapshotUnmatchedAccounts(supabase, index, new Set(), { keyByUrl, handles });

        expect(inserts.map((r) => [r.blotato_post_id, r.handle])).toEqual([
            ['1', '@sentinelaerialinspector'],
            ['2', 'The North East Corner (facebook)'],
            ['3', 'Sentinel Aerial Inspections (facebook)'],
            ['4', null],
        ]);
    });
});
