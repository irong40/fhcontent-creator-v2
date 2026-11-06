import { describe, it, expect } from 'vitest';
// Safe to import: the script's pure section reads no env and main() is guarded
// behind an invoked-directly check (import.meta.url vs process.argv[1]).
import {
    parseCliArgs,
    extractVideoId,
    videoDupKey,
    toMetricRow,
    hasSignal,
    isDupToday,
    interleave,
    todayUtcStartIso,
    nMetric,
    carryForwardEngagement,
    blotatoYouTubeEngagement,
    fillEngagement,
    priorEngagementFromRows,
    fetchAllPages,
} from './pull-youtube-metrics';

describe('parseCliArgs', () => {
    it('defaults: dry-run, per-channel 50, detail 15, no overrides', () => {
        const res = parseCliArgs([]);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.opts.commit).toBe(false);
            expect(res.opts.perChannel).toBe(50);
            expect(res.opts.detail).toBe(15);
            expect(res.opts.overrides.size).toBe(0);
        }
    });

    it('parses --commit, numeric flags and repeatable --channel overrides', () => {
        const res = parseCliArgs([
            '--commit', '--per-channel', '10', '--detail', '5',
            '--channel', '28719=https://www.youtube.com/channel/UCabc',
            '--channel', '1182=https://youtube.com/@adam',
        ]);
        expect(res.ok).toBe(true);
        if (res.ok) {
            expect(res.opts.commit).toBe(true);
            expect(res.opts.perChannel).toBe(10);
            expect(res.opts.detail).toBe(5);
            expect(res.opts.overrides.get('28719')).toBe('https://www.youtube.com/channel/UCabc');
            expect(res.opts.overrides.get('1182')).toBe('https://youtube.com/@adam');
        }
    });

    it('rejects unknown flags (a typo must not silently run a default pull)', () => {
        const res = parseCliArgs(['--comit']);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toContain('--comit');
    });

    it('rejects non-integer / missing numeric values', () => {
        expect(parseCliArgs(['--per-channel', 'abc']).ok).toBe(false);
        expect(parseCliArgs(['--per-channel']).ok).toBe(false);
        expect(parseCliArgs(['--detail', '0']).ok).toBe(false);
        expect(parseCliArgs(['--detail', '12.5']).ok).toBe(false);
    });

    it('rejects malformed --channel and non-http(s) urls (yt-dlp argv injection guard)', () => {
        expect(parseCliArgs(['--channel', 'nourl']).ok).toBe(false);
        expect(parseCliArgs(['--channel', '=https://x.com']).ok).toBe(false);
        expect(parseCliArgs(['--channel', '28719=--exec=rm']).ok).toBe(false);
        expect(parseCliArgs(['--channel', '28719=ftp://x']).ok).toBe(false);
    });

    it('treats --help as the usage path', () => {
        const res = parseCliArgs(['--help']);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toBe('usage');
    });
});

describe('extractVideoId', () => {
    it('extracts from every stored YouTube URL form', () => {
        expect(extractVideoId('https://www.youtube.com/watch?v=29vl0X3O9Y4')).toBe('29vl0X3O9Y4');
        expect(extractVideoId('https://youtu.be/29vl0X3O9Y4')).toBe('29vl0X3O9Y4');
        expect(extractVideoId('https://www.youtube.com/shorts/u0iDcwVqcX8')).toBe('u0iDcwVqcX8');
        expect(extractVideoId('https://m.youtube.com/watch?v=AD_bCXGWibc&t=10s')).toBe('AD_bCXGWibc');
        expect(extractVideoId('https://www.youtube.com/embed/Drvkl8WnW18')).toBe('Drvkl8WnW18');
        expect(extractVideoId('https://www.youtube.com/live/Drvkl8WnW18')).toBe('Drvkl8WnW18');
    });

    it('survives trailing slashes and query noise on path forms', () => {
        expect(extractVideoId('https://www.youtube.com/shorts/u0iDcwVqcX8/?feature=share')).toBe('u0iDcwVqcX8');
    });

    it('is null for non-YouTube URLs, junk, and channel pages', () => {
        expect(extractVideoId('https://www.tiktok.com/@x/video/123')).toBeNull();
        expect(extractVideoId('https://www.youtube.com/channel/UCZePAaXDTAmaliBNuB0AQ3w')).toBeNull();
        expect(extractVideoId('not a url')).toBeNull();
        expect(extractVideoId(null)).toBeNull();
        expect(extractVideoId(undefined)).toBeNull();
    });
});

describe('videoDupKey / isDupToday', () => {
    const row = toMetricRow({
        videoId: 'u0iDcwVqcX8', handle: 'They Never Told Us', pieceId: null,
        views: 918, likes: 3, comments: 1,
    });

    it('builds the platform|handle|videoId key', () => {
        expect(videoDupKey('They Never Told Us', 'u0iDcwVqcX8')).toBe('youtube|They Never Told Us|u0iDcwVqcX8');
    });

    it('skips when the video was already captured today under its handle', () => {
        const videoKeys = new Set([videoDupKey('They Never Told Us', 'u0iDcwVqcX8')]);
        expect(isDupToday(row, new Set(), videoKeys)).toBe(true);
    });

    it('skips when the matched piece was already snapshotted today (Blotato path)', () => {
        const matched = toMetricRow({
            videoId: 'AD_bCXGWibc', handle: 'Faith Harmony (SAI)', pieceId: 'piece-1',
            views: 21, likes: 0, comments: 0,
        });
        expect(isDupToday(matched, new Set(['piece-1']), new Set())).toBe(true);
        expect(isDupToday(matched, new Set(['other-piece']), new Set())).toBe(false);
    });

    it('does not skip a fresh video', () => {
        expect(isDupToday(row, new Set(), new Set())).toBe(false);
    });

    it('same video under a different handle is not treated as a dup (piece-less rows)', () => {
        const videoKeys = new Set([videoDupKey('Other Channel', 'u0iDcwVqcX8')]);
        expect(isDupToday(row, new Set(), videoKeys)).toBe(false);
    });
});

describe('toMetricRow / nMetric / hasSignal', () => {
    it('maps to the performance_metrics row shape with video id in blotato_post_id', () => {
        expect(toMetricRow({
            videoId: '29vl0X3O9Y4', handle: 'They Never Told Us', pieceId: 'p1',
            views: 1049, likes: 3, comments: 2,
        })).toEqual({
            content_piece_id: 'p1',
            platform: 'youtube',
            handle: 'They Never Told Us',
            blotato_post_id: '29vl0X3O9Y4',
            views: 1049, likes: 3, comments: 2,
            shares: 0, saves: 0, // YouTube exposes neither publicly
        });
    });

    it('coerces yt-dlp nulls (hidden like/comment counts) to 0, never NaN', () => {
        const row = toMetricRow({
            videoId: 'x', handle: 'h', pieceId: null,
            views: 21, likes: null, comments: undefined,
        });
        expect(row.likes).toBe(0);
        expect(row.comments).toBe(0);
        expect(Number.isNaN(row.views)).toBe(false);
        expect(nMetric('12')).toBe(12);
        expect(nMetric('junk')).toBe(0);
    });

    it('hasSignal mirrors analytics-pull: zero-signal rows are not snapshotted', () => {
        expect(hasSignal(toMetricRow({ videoId: 'x', handle: 'h', pieceId: null, views: 0, likes: 0, comments: 0 }))).toBe(false);
        expect(hasSignal(toMetricRow({ videoId: 'x', handle: 'h', pieceId: null, views: 1, likes: 0, comments: 0 }))).toBe(true);
    });
});

describe('carryForwardEngagement', () => {
    // The blocker this guards: a Short beyond the --detail budget gets only
    // flat-tab views; writing likes=0/comments=0 would zero-overwrite real
    // engagement in the latest-snapshot-wins winners RPCs.
    it('fills unfetched (null/undefined) likes and comments from prior engagement', () => {
        const cf = carryForwardEngagement({ likes: null, comments: undefined }, { likes: 40, comments: 12 });
        expect(cf).toEqual({ likes: 40, comments: 12, carried: true });
    });

    it('never overrides fetched values, including a real 0', () => {
        const cf = carryForwardEngagement({ likes: 0, comments: 3 }, { likes: 40, comments: 12 });
        expect(cf).toEqual({ likes: 0, comments: 3, carried: false });
    });

    it('carries only the unfetched field on a partial fetch', () => {
        const cf = carryForwardEngagement({ likes: 41, comments: null }, { likes: 40, comments: 12 });
        expect(cf).toEqual({ likes: 41, comments: 12, carried: true });
    });

    it('is a no-op without prior engagement (never-detailed video)', () => {
        const cf = carryForwardEngagement({ likes: null, comments: null }, undefined);
        expect(cf).toEqual({ likes: null, comments: null, carried: false });
    });

    it('carried result feeds toMetricRow without re-zeroing', () => {
        const cf = carryForwardEngagement({ likes: null, comments: null }, { likes: 40, comments: 12 });
        const row = toMetricRow({
            videoId: 'u0iDcwVqcX8', handle: 'They Never Told Us', pieceId: 'p1',
            views: 520, likes: cf.likes, comments: cf.comments,
        });
        expect(row.likes).toBe(40);
        expect(row.comments).toBe(12);
    });
});

describe('interleave', () => {
    it('alternates two recency-ordered lists, draining the longer tail', () => {
        expect(interleave(['v1', 'v2', 'v3'], ['s1'])).toEqual(['v1', 's1', 'v2', 'v3']);
        expect(interleave<string>([], ['s1', 's2'])).toEqual(['s1', 's2']);
    });
});

describe('todayUtcStartIso', () => {
    it('returns midnight UTC of the given instant', () => {
        expect(todayUtcStartIso(new Date('2026-07-24T20:30:15.123Z'))).toBe('2026-07-24T00:00:00.000Z');
        expect(todayUtcStartIso(new Date('2026-07-24T00:00:00.000Z'))).toBe('2026-07-24T00:00:00.000Z');
    });
});

describe('blotatoYouTubeEngagement', () => {
    const item = (platform: string, postUrl: string | null, metrics: Record<string, unknown> | null) =>
        ({ platform, postUrl, latestMetrics: metrics ? { metrics } : null });

    it('indexes YouTube items by video id with likes, comments and shares', () => {
        const m = blotatoYouTubeEngagement([
            item('youtube', 'https://www.youtube.com/shorts/abcDEF12345', { likesCount: 7, commentsCount: 2, sharesCount: 3, viewsCount: 900 }),
            item('instagram', 'https://www.instagram.com/p/xyz/', { likesCount: 50 }),
            item('youtube', null, { likesCount: 1 }),
            item('youtube', 'https://youtu.be/zzzzzz99999', null),
        ]);
        expect([...m.keys()]).toEqual(['abcDEF12345']);
        expect(m.get('abcDEF12345')).toEqual({ likes: 7, comments: 2, shares: 3 });
    });

    it('keeps the largest value per field when sort keys return the same video', () => {
        const m = blotatoYouTubeEngagement([
            item('youtube', 'https://www.youtube.com/watch?v=abcDEF12345', { likesCount: 7, commentsCount: 0, sharesCount: '4' }),
            item('youtube', 'https://youtu.be/abcDEF12345', { likesCount: 5, commentsCount: 1, sharesCount: 'junk' }),
        ]);
        expect(m.get('abcDEF12345')).toEqual({ likes: 7, comments: 1, shares: 4 });
    });

    it('keeps null for fields Blotato did not send, never 0', () => {
        const m = blotatoYouTubeEngagement([
            item('youtube', 'https://www.youtube.com/shorts/abcDEF12345', { viewsCount: 900 }),
        ]);
        expect(m.get('abcDEF12345')).toEqual({ likes: null, comments: null, shares: null });
    });
});

describe('fillEngagement', () => {
    const blFor = (metrics: Record<string, unknown>) => blotatoYouTubeEngagement([
        { platform: 'youtube', postUrl: 'https://youtu.be/abcDEF12345', latestMetrics: { metrics } },
    ]).get('abcDEF12345');
    const base = { videoId: 'abcDEF12345', handle: 'Faith Harmony (SAI)', pieceId: null, views: 10 };

    it('carries prior likes and comments when Blotato sent views only', () => {
        const f = fillEngagement({ likes: null, comments: null }, blFor({ viewsCount: '900' }), { likes: 40, comments: 12 });
        expect(f).toMatchObject({ likes: 40, comments: 12, carried: true });
        expect(toMetricRow({ ...base, ...f })).toMatchObject({ likes: 40, comments: 12 });
    });

    it('carries prior shares when Blotato no longer returns the video', () => {
        const f = fillEngagement({ likes: 5, comments: 1 }, undefined, { likes: 4, comments: 1, shares: 9 });
        expect(f.shares).toBe(9);
        expect(toMetricRow({ ...base, ...f }).shares).toBe(9);
    });

    it('never lets a stale Blotato count undercut the prior baseline', () => {
        const f = fillEngagement({ likes: null, comments: null }, blFor({ likesCount: 30, commentsCount: 20, sharesCount: 2 }), { likes: 40, comments: 12, shares: 5 });
        expect(f).toMatchObject({ likes: 40, comments: 20, shares: 5, carried: true });
    });

    it('fills from Blotato when it is ahead of the prior baseline', () => {
        const f = fillEngagement({ likes: null, comments: null }, blFor({ likesCount: 50, commentsCount: 13, sharesCount: 6 }), { likes: 40, comments: 12, shares: 5 });
        expect(f).toEqual({ likes: 50, comments: 13, shares: 6, carried: false });
    });

    it('keeps fetched yt-dlp values, a real 0 included', () => {
        const f = fillEngagement({ likes: 0, comments: 3 }, blFor({ likesCount: 50, commentsCount: 13 }), { likes: 40, comments: 12 });
        expect(f).toMatchObject({ likes: 0, comments: 3 });
    });

    it('leaves null when neither source has a value', () => {
        expect(fillEngagement({ likes: null, comments: null }, undefined, undefined))
            .toEqual({ likes: null, comments: null, shares: null, carried: false });
        expect(toMetricRow(base).saves).toBe(0);
    });
});

describe('priorEngagementFromRows', () => {
    const row = (likes: number | null, comments: number | null, shares: number | null, id = 'vid1') =>
        ({ blotato_post_id: id, likes, comments, shares });

    it('takes each field from its own latest row > 0 (newer {50,0} does not hide older comments 12)', () => {
        const m = priorEngagementFromRows([row(50, 0, null), row(40, 12, null)]);
        expect(m.get('vid1')).toEqual({ likes: 50, comments: 12 });
    });

    it('takes shares from its own latest row, apart from likes/comments', () => {
        const m = priorEngagementFromRows([row(9, 2, 0), row(5, 1, 3), row(4, 0, 7)]);
        expect(m.get('vid1')).toEqual({ likes: 9, comments: 2, shares: 3 });
    });

    it('leaves a field absent when no row has it > 0, and keeps videos apart', () => {
        const m = priorEngagementFromRows([row(0, 0, 4, 'a'), row(6, null, null, 'b')]);
        expect(m.get('a')).toEqual({ shares: 4 });
        expect(m.get('b')).toEqual({ likes: 6 });
    });

    it('skips a video whose rows carry no engagement at all', () => {
        expect(priorEngagementFromRows([row(0, null, 0)]).has('vid1')).toBe(false);
    });
});

describe('fetchAllPages', () => {
    // Fake PostgREST: never returns more than 1000 rows per call, whatever is asked.
    const API_CAP = 1000;
    const fakeTable = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
    const fakeClient = (table: Array<{ i: number }>, calls: Array<[number, number]>) =>
        async (from: number, to: number) => {
            calls.push([from, to]);
            return { data: table.slice(from, Math.min(to + 1, from + API_CAP)), error: null };
        };

    it('reads past the 1000-row API cap until a short page', async () => {
        const calls: Array<[number, number]> = [];
        const res = await fetchAllPages(fakeClient(fakeTable(2285), calls), 1000, 50);
        expect(res.rows).toHaveLength(2285);
        expect(res.rows[2284]).toEqual({ i: 2284 });
        expect(res.error).toBeNull();
        expect(res.capped).toBe(false);
        expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    });

    it('a baseline row past row 1000 still reaches priorEngagementFromRows', async () => {
        const rows = Array.from({ length: 1500 }, (_, i) => ({
            blotato_post_id: `v${i}`, likes: 1, comments: 0, shares: null as number | null,
        }));
        const res = await fetchAllPages(async (from, to) => ({ data: rows.slice(from, Math.min(to + 1, from + API_CAP)), error: null }), 1000, 50);
        expect(priorEngagementFromRows(res.rows).get('v1499')).toEqual({ likes: 1 });
    });

    it('reads one extra call when the total is an exact multiple of the page size', async () => {
        const calls: Array<[number, number]> = [];
        const res = await fetchAllPages(fakeClient(fakeTable(2000), calls), 1000, 50);
        expect(res.rows).toHaveLength(2000);
        expect(calls).toHaveLength(3);
        expect(res.capped).toBe(false);
    });

    it('reports capped when maxPages full pages were read', async () => {
        const res = await fetchAllPages(fakeClient(fakeTable(5000), []), 1000, 2);
        expect(res.rows).toHaveLength(2000);
        expect(res.capped).toBe(true);
    });

    it('returns the error with the page it failed on', async () => {
        let n = 0;
        const res = await fetchAllPages(async () => (n++ === 0
            ? { data: fakeTable(1000), error: null }
            : { data: null, error: { message: 'boom' } }), 1000, 50);
        expect(res.error).toBe('page 1: boom');
        expect(res.rows).toHaveLength(1000);
    });
});
