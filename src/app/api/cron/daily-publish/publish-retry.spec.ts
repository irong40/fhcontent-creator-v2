/**
 * Regression tests for the transient-total-failure retry path in publishTopic
 * (review 2026-07-04, finding at route.ts ~line 350).
 *
 * Bug: the `pieces` array fetched at the top of publishTopic was never
 * updated after this tick's failures were written to the DB, so a FRESH
 * topic failing every platform on its first tick had zero 'failed' entries
 * in the stale in-memory snapshot — hasRetryablePlatform returned false and
 * the topic was terminally marked 'failed' after 1 attempt instead of the
 * designed MAX_PLATFORM_RETRIES (exact shape of the 2026-06-28 Blotato 401
 * outage). Fixed by folding updatedPlatforms back into the in-memory piece.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
    createAdminClient: vi.fn(),
}));
vi.mock('@/lib/blotato', () => ({
    blotato: {
        uploadMedia: vi.fn(),
        publishPost: vi.fn(),
    },
    buildTarget: vi.fn(() => ({})),
}));
vi.mock('@/lib/notifications', () => ({
    notifyError: vi.fn(async () => undefined),
}));
vi.mock('@/lib/workflow-lock', () => ({
    acquireLock: vi.fn(async () => 'lock-token'),
    releaseLock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/evergreen', () => ({
    fillEvergreenGaps: vi.fn(async () => []),
}));

import { publishTopic } from './route';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { notifyError } from '@/lib/notifications';
import type { PlatformStatus } from '@/types/database';

interface RecordedCalls {
    topicUpdates: Array<Record<string, unknown>>;
    pieceUpdates: Array<Record<string, unknown>>;
}

/** Minimal chainable Supabase stub covering exactly the calls publishTopic makes. */
function makeSupabaseMock(
    topicRow: Record<string, unknown>,
    piecesRows: Array<Record<string, unknown>>,
    calls: RecordedCalls,
) {
    return {
        from(table: string) {
            if (table === 'topics') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: () => Promise.resolve({ data: topicRow, error: null }),
                        }),
                    }),
                    update: (payload: Record<string, unknown>) => ({
                        eq: () => {
                            calls.topicUpdates.push(payload);
                            return Promise.resolve({ error: null });
                        },
                    }),
                };
            }
            if (table === 'content_pieces') {
                return {
                    select: () => ({
                        eq: () => ({
                            order: () => Promise.resolve({ data: piecesRows, error: null }),
                        }),
                    }),
                    update: (payload: Record<string, unknown>) => ({
                        eq: () => {
                            calls.pieceUpdates.push(payload);
                            return Promise.resolve({ error: null });
                        },
                    }),
                };
            }
            if (table === 'published_log') {
                return {
                    select: () => ({
                        eq: () => Promise.resolve({ count: 0 }),
                    }),
                    insert: () => Promise.resolve({ error: null }),
                };
            }
            throw new Error(`Unexpected table in test: ${table}`);
        },
    };
}

function makeTopic(): Record<string, unknown> {
    return {
        id: 'topic-1',
        title: 'Test Topic',
        status: 'scheduled',
        publish_at: null, // legacy/no staggering → all piece slots fire immediately
        topic_hash: 'hash-1',
        personas: {
            id: 'persona-1',
            name: 'Test Persona',
            // Single configured platform keeps the per-platform 300ms throttle
            // to one sleep per test.
            platform_accounts: { tiktok: 'acct-tt' },
        },
    };
}

function makePiece(publishedPlatforms: Record<string, Partial<PlatformStatus>>): Record<string, unknown> {
    return {
        id: 'piece-1',
        piece_type: 'short_1',
        piece_order: 1,
        video_url: 'https://example.com/video.mp4',
        carousel_url: null,
        thumbnail_url: null,
        caption_long: 'caption',
        caption_short: 'caption',
        published_platforms: publishedPlatforms,
    };
}

describe('publishTopic transient total-failure retry (stale in-memory pieces regression)', () => {
    let calls: RecordedCalls;

    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    it('keeps a FRESH topic retryable when its first tick fails on every platform (2026-06-28 outage shape)', async () => {
        const supabaseMock = makeSupabaseMock(makeTopic(), [makePiece({})], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockRejectedValue(new Error('401 Unauthorized'));

        await publishTopic('topic-1');

        // This tick's failure was persisted with retry_count 1…
        expect(calls.pieceUpdates).toHaveLength(1);
        const persisted = calls.pieceUpdates[0].published_platforms as Record<string, PlatformStatus>;
        expect(persisted.tiktok).toMatchObject({ status: 'failed', retry_count: 1 });

        // …and the topic must be left retryable ('scheduled'), NOT terminal
        // 'failed'. Pre-fix, the stale snapshot (empty published_platforms)
        // made hasRetryablePlatform return false and this asserted 'failed'.
        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0]).toMatchObject({
            status: 'scheduled',
            error_message: 'Transient publish failure — retrying',
        });
        expect(notifyError).not.toHaveBeenCalled();
    });

    it('still terminally fails the topic once the retry budget is exhausted', async () => {
        // Prior state: tiktok failed 4 times. This tick's attempt (the 5th,
        // MAX_PLATFORM_RETRIES) also fails → after the fold-back, no platform
        // is retryable → status 'failed' + alert.
        const piece = makePiece({ tiktok: { status: 'failed', error: '401', retry_count: 4 } });
        const supabaseMock = makeSupabaseMock(makeTopic(), [piece], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockRejectedValue(new Error('401 Unauthorized'));

        await publishTopic('topic-1');

        const persisted = calls.pieceUpdates[0].published_platforms as Record<string, PlatformStatus>;
        expect(persisted.tiktok).toMatchObject({ status: 'failed', retry_count: 5 });

        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0]).toMatchObject({
            status: 'failed',
            error_message: 'All platform publishes failed (retries exhausted)',
        });
        expect(notifyError).toHaveBeenCalledTimes(1);
    });

    it('marks partially_published (no alert) when a prior success exists and this tick fails', async () => {
        const piece = makePiece({
            instagram: { status: 'published', post_id: 'p1' },
            tiktok: { status: 'failed', error: 'x', retry_count: 1 },
        });
        const supabaseMock = makeSupabaseMock(makeTopic(), [piece], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockRejectedValue(new Error('rate limit'));

        await publishTopic('topic-1');

        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0]).toMatchObject({ status: 'partially_published' });
        expect(notifyError).not.toHaveBeenCalled();
    });
});
