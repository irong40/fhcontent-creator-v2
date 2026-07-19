/**
 * Tests for the rolling-24h per-account cap guard in publishTopic — the fix for
 * the 2026-07-15/16 YouTube+TikTok quota-failure storm. When an account is
 * already at its provider cap, the platform is DEFERRED (no submit, no failed
 * row, no alert) rather than fired into a rejection.
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
import { notifyError } from '@/lib/notifications';
import { PLATFORM_DAILY_CAP } from '@/lib/publish-limits';

interface Recorded { topicUpdates: Array<Record<string, unknown>>; pieceUpdates: Array<Record<string, unknown>>; }

/** Supabase stub whose rpc returns a caller-supplied per-platform count. */
function makeSupabaseMock(
    topicRow: Record<string, unknown>,
    piecesRows: Array<Record<string, unknown>>,
    calls: Recorded,
    rpcCounts: Record<string, number>,
) {
    return {
        rpc: (_fn: string, args: { p_platform: string }) =>
            Promise.resolve({ data: rpcCounts[args.p_platform] ?? 0, error: null }),
        from(table: string) {
            if (table === 'topics') {
                return {
                    select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: topicRow, error: null }) }) }),
                    update: (payload: Record<string, unknown>) => ({
                        eq: () => { calls.topicUpdates.push(payload); return Promise.resolve({ error: null }); },
                    }),
                };
            }
            if (table === 'content_pieces') {
                return {
                    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: piecesRows, error: null }) }) }),
                    update: (payload: Record<string, unknown>) => ({
                        eq: () => { calls.pieceUpdates.push(payload); return Promise.resolve({ error: null }); },
                    }),
                };
            }
            if (table === 'published_log') {
                return { select: () => ({ eq: () => Promise.resolve({ count: 0 }) }), insert: () => Promise.resolve({ error: null }) };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    };
}

const topic = () => ({
    id: 'topic-1', title: 'T', status: 'scheduled', publish_at: null, topic_hash: 'h',
    personas: { id: 'p1', name: 'P', platform_accounts: { youtube: 'yt-1', tiktok: 'tt-1' } },
});
const piece = () => ({
    id: 'piece-1', piece_type: 'short_1', piece_order: 1,
    video_url: 'https://x/v.mp4', carousel_url: null, thumbnail_url: null,
    caption_long: 'c', caption_short: 'c', published_platforms: {},
});

describe('publishTopic 24h cap guard', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
        (blotato.uploadMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://cdn/u.mp4' });
        (blotato.publishPost as ReturnType<typeof vi.fn>).mockResolvedValue({ postSubmissionId: 'sub-1' });
    });

    it('defers the platform whose account is at cap; still ships the one under cap', async () => {
        // youtube at cap → deferred; tiktok well under → publishes.
        const supabase = makeSupabaseMock(topic(), [piece()], calls, {
            youtube: PLATFORM_DAILY_CAP.youtube, tiktok: 0,
        });
        (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase);

        const result = await publishTopic('topic-1');

        // Exactly one submission — tiktok. YouTube never hit Blotato.
        expect(blotato.publishPost).toHaveBeenCalledTimes(1);
        expect(result.capDeferrals?.some((d) => d.includes('youtube'))).toBe(true);
        // Deferral is not a failure: no failed youtube row written.
        const lastPiece = calls.pieceUpdates.at(-1)?.published_platforms as Record<string, { status: string }>;
        expect(lastPiece.youtube).toBeUndefined();
        expect(lastPiece.tiktok.status).toBe('pending');
    });

    it('defers all platforms when every account is at cap — no submit, no failure, no alert', async () => {
        const supabase = makeSupabaseMock(topic(), [piece()], calls, {
            youtube: PLATFORM_DAILY_CAP.youtube, tiktok: PLATFORM_DAILY_CAP.tiktok,
        });
        (createAdminClient as ReturnType<typeof vi.fn>).mockReturnValue(supabase);

        const result = await publishTopic('topic-1');

        expect(blotato.publishPost).not.toHaveBeenCalled();
        expect(result.deferred).toBe(true);
        expect(notifyError).not.toHaveBeenCalled();
        // Topic must NOT be marked failed for a pure deferral.
        expect(calls.topicUpdates.every((u) => u.status !== 'failed')).toBe(true);
    });
});
