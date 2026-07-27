/**
 * Tests for the manual-publish preparation step (2026-07-26 review).
 *
 * POST /api/topics/[id]/publish calls publishTopic directly: no DB pre-filter,
 * no selectPublishableTopics, no age bound at all. Two consequences had to be
 * closed before an operator's "Retry" could be trusted:
 *
 *  1. publishTopic flips the topic to 'publishing' and never touches
 *     publish_at, so a retry of anything older than the 22 h window ran while
 *     check-status's reach model said the topic was already unreachable — free
 *     to condemn every piece the run had not yet fired, and to write a terminal
 *     status over an in-progress publish.
 *  2. daily-publish now refuses to re-fire a piece the settlement pass
 *     condemned (that refusal is what makes the condemnation mean anything). An
 *     explicit operator retry is exactly the event that should overturn it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prepareManualPublish, type ManualPublishTopic } from './prepare';
import {
    isTopicPastPublisherReach,
    NEVER_FIRED_PREFIX,
    MAX_SLOT_OFFSET_HOURS,
    PUBLISHING_SELECTOR_CUTOFF_HOURS,
} from '@/app/api/cron/check-status/settle';
import { selectPublishableTopics } from '@/app/api/cron/daily-publish/route';
import { isSlotReady, PIECE_SLOT_OFFSET_HOURS } from '@/app/api/cron/daily-publish/helpers';
import type { PieceType } from '@/types/database';

type Row = Record<string, unknown>;

const NOW = new Date('2026-07-26T12:00:00.000Z');
const HOUR = 3600_000;

interface Recorded {
    topicUpdates: Row[];
    pieceUpdates: Array<{ id: string; payload: Row }>;
}

function makeSupabase(topic: Row, pieces: Row[], calls: Recorded) {
    return {
        from(table: string) {
            if (table === 'topics') {
                return {
                    update: (payload: Row) => ({
                        eq: () => {
                            calls.topicUpdates.push(payload);
                            Object.assign(topic, payload);
                            return Promise.resolve({ error: null });
                        },
                    }),
                };
            }
            if (table === 'content_pieces') {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: (_col: string, status: string) => Promise.resolve({
                                data: pieces.filter((p) => p.status === status),
                                error: null,
                            }),
                        }),
                    }),
                    update: (payload: Row) => ({
                        eq: (_col: string, id: string) => {
                            calls.pieceUpdates.push({ id, payload });
                            const target = pieces.find((p) => p.id === id);
                            if (target) Object.assign(target, payload);
                            return Promise.resolve({ error: null });
                        },
                    }),
                };
            }
            throw new Error(`Unexpected table in test: ${table}`);
        },
    };
}

const agedTopic = (overrides: Partial<ManualPublishTopic> = {}): ManualPublishTopic & Row => ({
    id: 'aged-1',
    status: 'partially_published',
    publish_at: '2026-07-21T13:00:00.000Z',
    publish_date: '2026-07-21',
    // Past the 7-day drain window: the cron cannot reach this row.
    published_at: '2026-07-15T13:00:00.000Z',
    ...overrides,
});

describe('prepareManualPublish — re-opening the publish window', () => {
    let calls: Recorded;
    beforeEach(() => { calls = { topicUpdates: [], pieceUpdates: [] }; });

    it('re-anchors publish_at when the cron can no longer reach the topic', async () => {
        const topic = agedTopic();
        const supabase = makeSupabase(topic, [], calls);

        const prep = await prepareManualPublish(supabase as never, topic, NOW);

        expect(prep.reAnchoredPublishAt).toBe(new Date(NOW.getTime() - MAX_SLOT_OFFSET_HOURS * HOUR).toISOString());
        expect(calls.topicUpdates).toHaveLength(1);
    });

    // "Publish Now" must stay "publish now": every piece slot is an offset from
    // publish_at, so anchoring at `now` would fire short_1 and leave the long
    // piece ten hours out.
    it('leaves every piece slot open', async () => {
        const topic = agedTopic();
        const supabase = makeSupabase(topic, [], calls);

        const prep = await prepareManualPublish(supabase as never, topic, NOW);

        for (const type of Object.keys(PIECE_SLOT_OFFSET_HOURS) as PieceType[]) {
            expect(isSlotReady(type, prep.reAnchoredPublishAt!, NOW)).toBe(true);
        }
    });

    // The point of the re-anchor: while the manual run is in flight, the
    // settlement pass must NOT read the topic as out of reach and start
    // condemning the pieces the run hasn't got to yet.
    it('puts the topic back inside the reach model the settlement pass uses', async () => {
        const topic = agedTopic();
        expect(isTopicPastPublisherReach(
            { ...topic, status: 'publishing', accounts: null }, NOW,
        )).toBe(true);

        const supabase = makeSupabase(topic, [], calls);
        await prepareManualPublish(supabase as never, topic, NOW);

        // publishTopic will set status='publishing' on success.
        const afterRun = { ...topic, status: 'publishing', accounts: null };
        expect(isTopicPastPublisherReach(afterRun, NOW)).toBe(false);
        // …and the cron keeps picking the topic up long enough to finish the
        // job (late render, draining cap, platform retries).
        const hoursLeft = PUBLISHING_SELECTOR_CUTOFF_HOURS - MAX_SLOT_OFFSET_HOURS;
        expect(isTopicPastPublisherReach(afterRun, new Date(NOW.getTime() + (hoursLeft - 1) * HOUR))).toBe(false);
        expect(selectPublishableTopics(
            [{ id: topic.id, title: 't', status: 'publishing', publish_at: topic.publish_at, publish_date: topic.publish_date, published_at: topic.published_at }],
            NOW,
        ).selected).toHaveLength(1);
    });

    it('fills a missing publish_date so the cron query can see the row at all', async () => {
        const topic = agedTopic({ publish_at: null, publish_date: null, published_at: null, status: 'failed' });
        const supabase = makeSupabase(topic, [], calls);

        const prep = await prepareManualPublish(supabase as never, topic, NOW);

        expect(prep.reAnchoredPublishDate).toBe('2026-07-26');
        expect(topic.publish_date).toBe('2026-07-26');
    });

    // The 8 live 'scheduled' rows with publish_date NULL: publishTopic fires
    // them, they land at status='publishing', and daily-publish's own query
    // (publish_date IS NOT NULL) never returns them again — so any piece that
    // did not fire on that single run is stranded, with nothing able to publish
    // it and nothing able to settle the topic.
    it('anchors a manual publish that has no publish_at at all', async () => {
        const topic = agedTopic({ status: 'scheduled', publish_at: null, publish_date: null, published_at: null });
        const supabase = makeSupabase(topic, [], calls);

        const prep = await prepareManualPublish(supabase as never, topic, NOW);

        expect(prep.reAnchoredPublishAt).toBeTruthy();
        expect(prep.reAnchoredPublishDate).toBe('2026-07-26');
        // The cron can now both see the row and reach it.
        expect(selectPublishableTopics(
            [{ id: topic.id, title: 't', status: 'publishing', publish_at: topic.publish_at, publish_date: topic.publish_date, published_at: null }],
            NOW,
        ).selected).toHaveLength(1);
    });

    it('anchors a manual retry of a published topic (the cron never reaches those)', async () => {
        const topic = agedTopic({ status: 'published', published_at: '2026-07-26T11:00:00.000Z' });
        const supabase = makeSupabase(topic, [], calls);

        const prep = await prepareManualPublish(supabase as never, topic, NOW);

        expect(prep.reAnchoredPublishAt).toBeTruthy();
    });

    it('leaves a topic being published on schedule completely alone', async () => {
        const topic = agedTopic({
            status: 'scheduled',
            publish_at: '2026-07-26T13:00:00.000Z',
            publish_date: '2026-07-26',
            published_at: null,
        });
        const supabase = makeSupabase(topic, [], calls);

        const prep = await prepareManualPublish(supabase as never, topic, NOW);

        expect(prep.reAnchoredPublishAt).toBeUndefined();
        expect(calls.topicUpdates).toHaveLength(0);
    });

    it('leaves a topic still inside its publish window alone', async () => {
        const topic = agedTopic({
            status: 'publishing',
            publish_at: '2026-07-26T09:00:00.000Z',
            publish_date: '2026-07-26',
            published_at: null,
        });
        const supabase = makeSupabase(topic, [], calls);

        await prepareManualPublish(supabase as never, topic, NOW);

        expect(calls.topicUpdates).toHaveLength(0);
    });
});

describe('prepareManualPublish — un-condemning never-fired pieces', () => {
    let calls: Recorded;
    beforeEach(() => { calls = { topicUpdates: [], pieceUpdates: [] }; });

    const condemned = () => ({
        id: 'long-1', status: 'failed', published_platforms: {},
        error_message: `${NEVER_FIRED_PREFIX} media arrived after the topic left daily-publish's publish window (never submitted)`,
    });

    it('clears the settlement marker so the publisher will ship the piece', async () => {
        const piece = condemned();
        const supabase = makeSupabase(agedTopic(), [piece], calls);

        const prep = await prepareManualPublish(supabase as never, agedTopic(), NOW);

        expect(prep.unCondemnedPieceIds).toEqual(['long-1']);
        expect(piece.status).toBe('produced');
        expect(piece.error_message).toBeNull();
    });

    it('leaves pieces that failed for other reasons terminal', async () => {
        // daily-media's 0-slide carousel: dead for a reason a retry cannot fix.
        const carousel = {
            id: 'carousel-1', status: 'failed', published_platforms: {},
            error_message: 'Carousel: 0/6 slides rendered (satori template renderer failed)',
        };
        const supabase = makeSupabase(agedTopic(), [carousel], calls);

        const prep = await prepareManualPublish(supabase as never, agedTopic(), NOW);

        expect(prep.unCondemnedPieceIds).toBeUndefined();
        expect(carousel.status).toBe('failed');
    });

    it('leaves a piece that actually fired alone', async () => {
        const fired = {
            id: 'short-1', status: 'failed',
            published_platforms: { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
            error_message: `${NEVER_FIRED_PREFIX} something`,
        };
        const supabase = makeSupabase(agedTopic(), [fired], calls);

        await prepareManualPublish(supabase as never, agedTopic(), NOW);

        expect(calls.pieceUpdates).toHaveLength(0);
    });
});
