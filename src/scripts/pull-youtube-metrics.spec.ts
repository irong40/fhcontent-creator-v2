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
