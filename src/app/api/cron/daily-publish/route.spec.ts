import { describe, it, expect } from 'vitest';
import {
    countPlatformOutcomes,
    hasRetryablePlatform,
    selectPublishableTopics,
    MAX_SCHEDULED_AGE_DAYS,
    MAX_TOPICS_PER_TICK,
    type SelectableTopic,
} from './route';
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

describe('selectPublishableTopics', () => {
    // Fixed "now" for deterministic date math: 2026-07-04 15:00 UTC.
    const NOW = new Date('2026-07-04T15:00:00.000Z');

    function daysAgoDate(days: number): string {
        return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    let seq = 0;
    function topic(overrides: Partial<SelectableTopic>): SelectableTopic {
        seq += 1;
        return {
            id: `t-${seq}`,
            title: `Topic ${seq}`,
            status: 'scheduled',
            publish_at: null,
            publish_date: daysAgoDate(0),
            published_at: null,
            ...overrides,
        };
    }

    it('selects a scheduled topic due today with past publish_at', () => {
        const t = topic({ publish_at: '2026-07-04T13:00:00.000Z' });
        const { selected, staleSkipped } = selectPublishableTopics([t], NOW);
        expect(selected).toEqual([t]);
        expect(staleSkipped).toEqual([]);
    });

    it('defers a scheduled topic whose publish_at is still in the future', () => {
        const t = topic({ publish_at: '2026-07-04T18:00:00.000Z' });
        const { selected, staleSkipped } = selectPublishableTopics([t], NOW);
        expect(selected).toEqual([]);
        expect(staleSkipped).toEqual([]); // not stale, just not due yet
    });

    it('selects a legacy scheduled topic (no publish_at) inside the staleness window', () => {
        const t = topic({ publish_at: null, publish_date: daysAgoDate(1) });
        expect(selectPublishableTopics([t], NOW).selected).toEqual([t]);
    });

    describe('staleness lower bound (2026-06-02 incident guard)', () => {
        it('skips a scheduled topic older than MAX_SCHEDULED_AGE_DAYS', () => {
            const stale = topic({ publish_date: daysAgoDate(MAX_SCHEDULED_AGE_DAYS + 1) });
            const { selected, staleSkipped } = selectPublishableTopics([stale], NOW);
            expect(selected).toEqual([]);
            expect(staleSkipped).toEqual([stale]);
        });

        it('still selects a topic exactly at the staleness boundary', () => {
            const boundary = topic({ publish_date: daysAgoDate(MAX_SCHEDULED_AGE_DAYS) });
            const { selected, staleSkipped } = selectPublishableTopics([boundary], NOW);
            expect(selected).toEqual([boundary]);
            expect(staleSkipped).toEqual([]);
        });

        it('applies the staleness bound to approved topics too', () => {
            const stale = topic({ status: 'approved', publish_date: daysAgoDate(30) });
            const { selected, staleSkipped } = selectPublishableTopics([stale], NOW);
            expect(selected).toEqual([]);
            expect(staleSkipped).toEqual([stale]);
        });

        it('a stale topic is skipped even when its publish_at is past (restored-backlog shape)', () => {
            // Exact 2026-06-02 shape: old scheduled rows restored with past
            // publish_date AND past publish_at — every slot already elapsed.
            const stale = topic({
                publish_date: daysAgoDate(14),
                publish_at: new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
            });
            const { selected, staleSkipped } = selectPublishableTopics([stale], NOW);
            expect(selected).toEqual([]);
            expect(staleSkipped).toEqual([stale]);
        });

        it('does NOT apply the scheduled-staleness bound to partially_published (7-day published_at window governs)', () => {
            const partial = topic({
                status: 'partially_published',
                publish_date: daysAgoDate(6), // older than MAX_SCHEDULED_AGE_DAYS
                published_at: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
            });
            expect(selectPublishableTopics([partial], NOW).selected).toEqual([partial]);
        });

        it('drops partially_published topics past the 7-day window', () => {
            const old = topic({
                status: 'partially_published',
                published_at: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
            });
            const { selected, staleSkipped } = selectPublishableTopics([old], NOW);
            expect(selected).toEqual([]);
            expect(staleSkipped).toEqual([]); // dropped by its own window, not the stale guard
        });

        it('keeps publishing topics within 22h of publish_at and drops older ones', () => {
            const fresh = topic({
                status: 'publishing',
                publish_at: new Date(NOW.getTime() - 10 * 60 * 60 * 1000).toISOString(),
            });
            const old = topic({
                status: 'publishing',
                publish_at: new Date(NOW.getTime() - 23 * 60 * 60 * 1000).toISOString(),
            });
            expect(selectPublishableTopics([fresh, old], NOW).selected).toEqual([fresh]);
        });
    });

    describe('per-tick cap', () => {
        it('regression: a 26-topic restored backlog dated today cannot mass-fire in one tick', () => {
            // Even if a backlog is re-dated to TODAY (defeating the staleness
            // bound), the cap keeps a single tick from blasting platform caps.
            const backlog = Array.from({ length: 26 }, () => topic({ publish_date: daysAgoDate(0) }));
            const { selected, capDeferred } = selectPublishableTopics(backlog, NOW);
            expect(selected).toHaveLength(MAX_TOPICS_PER_TICK);
            expect(capDeferred).toHaveLength(26 - MAX_TOPICS_PER_TICK);
        });

        it('does not cap normal steady-state volume', () => {
            const normal = [
                topic({}),
                topic({}),
                topic({ status: 'publishing', publish_at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString() }),
            ];
            const { selected, capDeferred } = selectPublishableTopics(normal, NOW);
            expect(selected).toHaveLength(3);
            expect(capDeferred).toEqual([]);
        });

        it('cap applies after filtering — stale topics do not consume cap slots', () => {
            const stale = Array.from({ length: 10 }, () => topic({ publish_date: daysAgoDate(10) }));
            const due = [topic({}), topic({})];
            const { selected, staleSkipped, capDeferred } = selectPublishableTopics([...stale, ...due], NOW);
            expect(selected).toEqual(due);
            expect(staleSkipped).toHaveLength(10);
            expect(capDeferred).toEqual([]);
        });
    });
});
