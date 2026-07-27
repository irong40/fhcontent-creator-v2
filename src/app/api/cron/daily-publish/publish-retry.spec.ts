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
        // count_recent_account_posts — 0 keeps the 24h cap guard inert here.
        rpc: () => Promise.resolve({ data: 0, error: null }),
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

function makeTopic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'topic-1',
        title: 'Test Topic',
        status: 'scheduled',
        publish_at: null, // legacy/no staggering → all piece slots fire immediately
        published_at: null,
        topic_hash: 'hash-1',
        personas: {
            id: 'persona-1',
            name: 'Test Persona',
            // Single configured platform keeps the per-platform 300ms throttle
            // to one sleep per test.
            platform_accounts: { tiktok: 'acct-tt' },
        },
        ...overrides,
    };
}

function makePiece(
    publishedPlatforms: Record<string, Partial<PlatformStatus>>,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        id: 'piece-1',
        piece_type: 'short_1',
        piece_order: 1,
        status: 'produced',
        video_url: 'https://example.com/video.mp4',
        carousel_url: null,
        thumbnail_url: null,
        caption_long: 'caption',
        caption_short: 'caption',
        published_platforms: publishedPlatforms,
        ...overrides,
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

    // selectPublishableTopics gates 'partially_published' on
    // `published_at && published_at > sevenDaysAgo`. Writing the status without
    // the timestamp dropped the topic out of this cron's OWN selector the
    // moment it was written — mid publish-day, with the carousel (+6h),
    // short_4 (+8h) and long (+10h) slots still unfired — and check-status then
    // read the same row as already unreachable and condemned those pieces.
    it('sets published_at with partially_published so the topic stays in its own drain window', async () => {
        const piece = makePiece({
            instagram: { status: 'published', post_id: 'p1' },
            tiktok: { status: 'failed', error: 'x', retry_count: 1 },
        });
        const topic = makeTopic({ publish_at: '2026-07-21T13:00:00.000Z' });
        const supabaseMock = makeSupabaseMock(topic, [piece], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockRejectedValue(new Error('rate limit'));

        await publishTopic('topic-1');

        // Anchored on the topic's own publish instant, so the 7-day window runs
        // from the publish day rather than from whichever retry tick failed.
        expect(calls.topicUpdates[0]).toMatchObject({
            status: 'partially_published',
            published_at: '2026-07-21T13:00:00.000Z',
        });
    });

    it('never overwrites an existing published_at', async () => {
        const piece = makePiece({
            instagram: { status: 'published', post_id: 'p1' },
            tiktok: { status: 'failed', error: 'x', retry_count: 1 },
        });
        const topic = makeTopic({
            publish_at: '2026-07-21T13:00:00.000Z',
            published_at: '2026-07-21T13:10:00.000Z',
        });
        const supabaseMock = makeSupabaseMock(topic, [piece], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockRejectedValue(new Error('rate limit'));

        await publishTopic('topic-1');

        expect(calls.topicUpdates[0]).toMatchObject({ published_at: '2026-07-21T13:10:00.000Z' });
    });
});

/**
 * check-status marks a piece that could never fire `status='failed'` with an
 * empty platform map, alerts the operator that it "could never publish", and
 * settles the topic. That marker used to be inert — this loop never read
 * piece.status — so once the settlement write put a partially_published topic
 * back inside its drain window, the very next hourly tick published the piece
 * the operator had just been told was dead: days-stale content, no review gate
 * (2026-07-26 review).
 */
describe('publishTopic — terminally dead pieces are not re-fired', () => {
    let calls: RecordedCalls;

    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    it('skips a condemned piece even though its media and targets are fine', async () => {
        // The faf48142 shape: the late render DID land, and the persona has a
        // configured tiktok account — every piece-level check passes.
        const piece = makePiece({}, { status: 'failed' });
        const supabaseMock = makeSupabaseMock(makeTopic(), [piece], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);

        const result = await publishTopic('topic-1');

        expect(blotato.uploadMedia).not.toHaveBeenCalled();
        expect(blotato.publishPost).not.toHaveBeenCalled();
        expect(calls.pieceUpdates).toHaveLength(0);
        expect(result.piecesProcessed).toBe(0);
        // A permanently dead piece must not re-send the warnings alert email on
        // every hourly tick either.
        expect(result.warnings).toHaveLength(0);
        expect(notifyError).not.toHaveBeenCalled();
    });

    // The skip is keyed on "failed AND never fired". A piece that DID fire and
    // has a platform under its retry budget is still the publisher's business —
    // over-broad skipping here would silently drop retries.
    it('still retries a failed platform on a piece that has fired', async () => {
        const piece = makePiece(
            { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
            { status: 'failed' },
        );
        const supabaseMock = makeSupabaseMock(makeTopic(), [piece], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockResolvedValue({ url: 'https://blotato/m.mp4' } as never);
        vi.mocked(blotato.publishPost).mockResolvedValue({ postSubmissionId: 'sub-1' } as never);

        const result = await publishTopic('topic-1');

        expect(blotato.publishPost).toHaveBeenCalledTimes(1);
        expect(result.piecesProcessed).toBe(1);
    });

    it('still publishes a healthy piece on the same topic', async () => {
        const dead = makePiece({}, { id: 'piece-dead', status: 'failed' });
        const live = makePiece({}, { id: 'piece-live', piece_order: 2 });
        const supabaseMock = makeSupabaseMock(makeTopic(), [dead, live], calls);
        vi.mocked(createAdminClient).mockReturnValue(supabaseMock as unknown as ReturnType<typeof createAdminClient>);
        vi.mocked(blotato.uploadMedia).mockResolvedValue({ url: 'https://blotato/m.mp4' } as never);
        vi.mocked(blotato.publishPost).mockResolvedValue({ postSubmissionId: 'sub-2' } as never);

        const result = await publishTopic('topic-1');

        expect(result.piecesProcessed).toBe(1);
        expect(calls.pieceUpdates).toHaveLength(1);
    });
});
