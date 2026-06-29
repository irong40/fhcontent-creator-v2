import { describe, it, expect } from 'vitest';
import { countPlatformOutcomes, hasRetryablePlatform } from './route';
import type { ContentPiece, PlatformStatus } from '@/types/database';

/**
 * Stub a ContentPiece with only the published_platforms map populated.
 * Casts via unknown because we don't care about the other fields for
 * countPlatformOutcomes - it only reads published_platforms.
 */
function piece(platforms: Record<string, Partial<PlatformStatus>>): ContentPiece {
    return { published_platforms: platforms } as unknown as ContentPiece;
}

describe('countPlatformOutcomes', () => {
    it('returns zeros for empty pieces array', () => {
        expect(countPlatformOutcomes([])).toEqual({ published: 0, failed: 0 });
    });

    it('returns zeros when pieces have no platforms', () => {
        const pieces = [piece({}), piece({})];
        expect(countPlatformOutcomes(pieces)).toEqual({ published: 0, failed: 0 });
    });

    it('counts a single published platform on a single piece', () => {
        const pieces = [piece({ tiktok: { status: 'published' } })];
        expect(countPlatformOutcomes(pieces)).toEqual({ published: 1, failed: 0 });
    });

    it('counts a single failed platform on a single piece', () => {
        const pieces = [piece({ tiktok: { status: 'failed', error: 'rate limit' } })];
        expect(countPlatformOutcomes(pieces)).toEqual({ published: 0, failed: 1 });
    });

    it('treats pending status as neither published nor failed', () => {
        const pieces = [piece({ tiktok: { status: 'pending' } })];
        expect(countPlatformOutcomes(pieces)).toEqual({ published: 0, failed: 0 });
    });

    it('aggregates across multiple pieces and platforms', () => {
        const pieces = [
            piece({
                tiktok: { status: 'published' },
                instagram: { status: 'published' },
                youtube: { status: 'failed', error: 'auth' },
            }),
            piece({
                tiktok: { status: 'failed', error: 'rate limit' },
                threads: { status: 'published' },
                twitter: { status: 'pending' },
            }),
        ];
        expect(countPlatformOutcomes(pieces)).toEqual({ published: 3, failed: 2 });
    });

    it('correctly identifies the partial-success case (any prior success)', () => {
        // This is the core decision the function supports: if any platform
        // has ever published, the topic is partially_published not failed.
        const pieces = [
            piece({
                tiktok: { status: 'published' },
                instagram: { status: 'failed', error: 'a' },
                youtube: { status: 'failed', error: 'b' },
            }),
        ];
        const totals = countPlatformOutcomes(pieces);
        expect(totals.published).toBeGreaterThan(0);
        expect(totals.failed).toBeGreaterThan(0);
    });

    it('correctly identifies the total-failure case (no prior success)', () => {
        const pieces = [
            piece({
                tiktok: { status: 'failed', error: 'a' },
                instagram: { status: 'failed', error: 'b' },
            }),
        ];
        const totals = countPlatformOutcomes(pieces);
        expect(totals.published).toBe(0);
        expect(totals.failed).toBeGreaterThan(0);
    });

    it('handles null/undefined published_platforms gracefully', () => {
        const pieces = [
            { published_platforms: null } as unknown as ContentPiece,
            { published_platforms: undefined } as unknown as ContentPiece,
        ];
        expect(countPlatformOutcomes(pieces)).toEqual({ published: 0, failed: 0 });
    });
});

describe('hasRetryablePlatform', () => {
    const MAX = 5;

    it('is true for a fresh failure (retry_count 0) — the transient Blotato-401 case', () => {
        // Regression: this exact shape (every platform failed with retry_count 1,
        // no prior success) was marked terminally failed during the 6/28 outage.
        const pieces = [piece({
            tiktok: { status: 'failed', error: '401', retry_count: 1 },
            youtube: { status: 'failed', error: '401', retry_count: 1 },
        })];
        expect(hasRetryablePlatform(pieces, MAX)).toBe(true);
    });

    it('is false once every failed platform has exhausted its retry budget', () => {
        const pieces = [piece({
            tiktok: { status: 'failed', error: 'x', retry_count: 5 },
            youtube: { status: 'failed', error: 'x', retry_count: 6 },
        })];
        expect(hasRetryablePlatform(pieces, MAX)).toBe(false);
    });

    it('is true if at least one failed platform is still under budget', () => {
        const pieces = [piece({
            tiktok: { status: 'failed', error: 'x', retry_count: 5 },
            youtube: { status: 'failed', error: 'x', retry_count: 2 },
        })];
        expect(hasRetryablePlatform(pieces, MAX)).toBe(true);
    });

    it('ignores non-failed platforms and empty maps', () => {
        expect(hasRetryablePlatform([piece({ tiktok: { status: 'pending' } })], MAX)).toBe(false);
        expect(hasRetryablePlatform([piece({})], MAX)).toBe(false);
    });
});
