/**
 * The source gate is asked before anything leaves (Codex review 2026-10-05, critical 1).
 *
 * Before this, publishTopic posted to the platforms and set the topic's status afterwards.
 * The database refused the status change for a topic with no passing source check, but the
 * post was already out. The Publish button also accepts failed and partially published
 * topics, which reach publishTopic without ever passing through a gated status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/blotato', () => ({
    blotato: { uploadMedia: vi.fn(), publishPost: vi.fn() },
    buildTarget: vi.fn(() => ({})),
}));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn(async () => undefined) }));
vi.mock('@/lib/workflow-lock', () => ({
    acquireLock: vi.fn(async () => 'lock-token'),
    releaseLock: vi.fn(async () => undefined),
}));
vi.mock('@/lib/evergreen', () => ({ fillEvergreenGaps: vi.fn(async () => []) }));

import { publishTopic } from './route';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { SOURCE_CHECK_REQUIRED } from '@/lib/source-gate';

interface Calls {
    order: string[];
    topicUpdates: Array<Record<string, unknown>>;
    pieceUpdates: Array<Record<string, unknown>>;
}

function makeSupabaseMock(
    status: string,
    gate: { data: unknown; error: { message: string } | null },
    calls: Calls,
) {
    const topicRow = {
        id: 'topic-1',
        title: 'Test Topic',
        status,
        publish_at: null,
        topic_hash: 'hash-1',
        personas: { id: 'persona-1', name: 'Test Persona', platform_accounts: { tiktok: 'acct-tt' } },
    };
    const piece = {
        id: 'piece-1',
        piece_type: 'short_1',
        piece_order: 1,
        video_url: 'https://example.com/video.mp4',
        carousel_url: null,
        thumbnail_url: null,
        caption_long: 'caption',
        caption_short: 'caption',
        published_platforms: {},
    };
    return {
        rpc: (fn: string) => {
            calls.order.push(`rpc:${fn}`);
            return Promise.resolve(fn === 'topic_source_cleared' ? gate : { data: 0, error: null });
        },
        from(table: string) {
            if (table === 'topics') {
                return {
                    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: topicRow, error: null }) }) }),
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
                            order: () => {
                                calls.order.push('read:content_pieces');
                                return Promise.resolve({ data: [piece], error: null });
                            },
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
                    select: () => ({ eq: () => Promise.resolve({ count: 0 }) }),
                    insert: () => Promise.resolve({ error: null }),
                };
            }
            throw new Error(`Unexpected table in test: ${table}`);
        },
    };
}

function use(mock: ReturnType<typeof makeSupabaseMock>) {
    vi.mocked(createAdminClient).mockReturnValue(mock as unknown as ReturnType<typeof createAdminClient>);
}

describe('publishTopic asks the source gate before anything leaves', () => {
    let calls: Calls;

    beforeEach(() => {
        vi.clearAllMocks();
        calls = { order: [], topicUpdates: [], pieceUpdates: [] };
        vi.mocked(blotato.uploadMedia).mockResolvedValue({ url: 'https://cdn.example/video.mp4' } as never);
        vi.mocked(blotato.publishPost).mockResolvedValue({ postSubmissionId: 'post-1' } as never);
    });

    it.each(['scheduled', 'approved', 'failed', 'partially_published', 'publishing'])(
        'sends nothing for a %s topic with no passing source check',
        async (status) => {
            use(makeSupabaseMock(status, { data: false, error: null }, calls));

            const result = await publishTopic('topic-1');

            expect(result.blocked).toContain(SOURCE_CHECK_REQUIRED);
            expect(result.piecesProcessed).toBe(0);
            expect(blotato.uploadMedia).not.toHaveBeenCalled();
            expect(blotato.publishPost).not.toHaveBeenCalled();
            expect(calls.topicUpdates).toHaveLength(0);
            expect(calls.pieceUpdates).toHaveLength(0);
        },
    );

    it('sends nothing when the source check cannot be read', async () => {
        use(makeSupabaseMock('scheduled', { data: null, error: { message: 'function topic_source_cleared does not exist' } }, calls));

        const result = await publishTopic('topic-1');

        expect(result.blocked).toContain('could not be read');
        expect(blotato.publishPost).not.toHaveBeenCalled();
        expect(calls.topicUpdates).toHaveLength(0);
    });

    it('asks the gate before it reads a single content piece', async () => {
        use(makeSupabaseMock('scheduled', { data: true, error: null }, calls));

        await publishTopic('topic-1');

        expect(calls.order[0]).toBe('rpc:topic_source_cleared');
        expect(calls.order.indexOf('rpc:topic_source_cleared')).toBeLessThan(calls.order.indexOf('read:content_pieces'));
    });

    it('publishes a topic whose newest source check is a pass', async () => {
        use(makeSupabaseMock('scheduled', { data: true, error: null }, calls));

        const result = await publishTopic('topic-1');

        expect(result.blocked).toBeUndefined();
        expect(blotato.publishPost).toHaveBeenCalledTimes(1);
        expect(calls.topicUpdates).toContainEqual({ status: 'publishing' });
    });
});
