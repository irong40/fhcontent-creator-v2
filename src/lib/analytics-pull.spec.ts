import { describe, it, expect } from 'vitest';
import { mapMetrics, normalizeUrl } from './analytics-pull';

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
