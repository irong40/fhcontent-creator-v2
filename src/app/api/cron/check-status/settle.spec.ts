/**
 * Tests for the topic settlement rules — the fix for the 2026-07-21 freeze.
 *
 * Topic faf48142-0330-4b14-8304-e03fefbf8369 latched at status='publishing'
 * with published_at NULL: 5 of its 6 pieces published on schedule, but the
 * 'long' piece never fired and the old "hold until every piece has fired or is
 * terminally failed" rule never cleared.
 *
 * THE FIXTURE BELOW IS THE LIVE ROW, NOT A RECONSTRUCTION. Verified by SELECT
 * against project qjpujskwqaehxnqypxzu on 2026-07-26:
 *
 *   content_pieces 1b8b6a3f-b5ca-46f7-9e0c-8cabfb838dd9
 *     piece_type='long', status='produced', published_platforms={},
 *     video_url='https://qjpujskwqaehxnqypxzu.supabase.co/storage/v1/object/
 *                public/media/longform/2026-07-24/1b8b6a3f-….mp4'
 *     produced_at=2026-07-24 09:32:20Z   (58 h after its 23:00Z slot)
 *   personas 6ac9adfa (Dr. Imani Carter)
 *     platform_accounts={tiktok,threads,twitter,youtube,instagram},
 *     facebook_enabled=false
 *
 * video_url is NOT NULL and 'long' resolves to three configured targets. An
 * earlier version of this file asserted video_url was NULL for the whole
 * publish window; that was false, and it hid the fact that the first fix could
 * not settle the very topic it was written for. Any predicate keyed on the
 * PIECE (media, targets) passes here. The piece is dead because of the TOPIC:
 * daily-publish's selector stopped returning it 22 h after publish_at, so
 * publishTopic is never invoked for it again.
 *
 * The rules under test hold in every case where a piece could still ship (slot
 * not reached, topic still inside the publisher's window, provider-cap
 * deferred, platform submission still pending at Blotato) and only settle once
 * the publisher can no longer reach the topic at all. Losing a publishable
 * piece is worse than settling late.
 */
import { describe, it, expect } from 'vitest';
import {
    settleTopic,
    isPieceUnfireable,
    isTopicPastPublisherReach,
    publisherReachEnd,
    publishAtRepair,
    canPublisherRetryAsScheduled,
    classifyPlatformEntry,
    SETTLE_MARGIN_HOURS,
    MAX_SLOT_OFFSET_HOURS,
    PUBLISHING_SELECTOR_CUTOFF_HOURS,
    PARTIAL_DRAIN_WINDOW_DAYS,
    MAX_PLATFORM_RETRIES,
    type SettlementPiece,
    type SettlementContext,
} from './settle';
import { selectPublishableTopics, MAX_SCHEDULED_AGE_DAYS } from '../daily-publish/route';
import { isSlotReady, PIECE_SLOT_OFFSET_HOURS } from '../daily-publish/helpers';
import type { PieceType, PlatformAccounts } from '@/types/database';

/** The real incident's base slot: publish_at 2026-07-21 13:00Z. */
const PUBLISH_AT = '2026-07-21T13:00:00.000Z';
const HOUR = 3600_000;
const at = (hours: number) => new Date(new Date(PUBLISH_AT).getTime() + hours * HOUR);

/** daily-publish stops selecting a 'publishing' topic here (+22h). */
const REACH_END = at(PUBLISHING_SELECTOR_CUTOFF_HOURS);
/** …and settlement waits one more publisher tick past that. */
const SETTLE_TIME = at(PUBLISHING_SELECTOR_CUTOFF_HOURS + SETTLE_MARGIN_HOURS);
/** Comfortably past everything. */
const NOW = at(PUBLISHING_SELECTOR_CUTOFF_HOURS + SETTLE_MARGIN_HOURS + 1);

/** Dr. Imani Carter's live platform_accounts. */
const ACCOUNTS = {
    tiktok: '5294', threads: '1506', twitter: '1478', youtube: '1290', instagram: '4346',
} as unknown as PlatformAccounts;

function ctx(overrides: Partial<SettlementContext> = {}): SettlementContext {
    return {
        status: 'publishing',
        publish_at: PUBLISH_AT,
        publish_date: '2026-07-21',
        published_at: null,
        accounts: ACCOUNTS,
        facebook: { enabled: false, pageIds: null },
        ...overrides,
    };
}

let seq = 0;
function piece(overrides: Partial<SettlementPiece> = {}): SettlementPiece {
    seq += 1;
    return {
        id: `piece-${seq}`,
        piece_type: 'short_1',
        status: 'produced',
        published_platforms: {},
        video_url: 'https://cdn/v.mp4',
        carousel_url: null,
        ...overrides,
    };
}

/** A piece that shipped to every platform it targets, all confirmed. */
function shipped(pieceType: PieceType, platforms = ['tiktok', 'threads', 'twitter', 'youtube', 'instagram']): SettlementPiece {
    return piece({
        piece_type: pieceType,
        status: 'published',
        published_platforms: Object.fromEntries(
            platforms.map((p) => [p, { status: 'published', post_id: `${pieceType}-${p}` }]),
        ),
    });
}

/** The real faf48142 long piece: media present (delivered 58 h late), five
 *  configured targets, never submitted anywhere. */
function lateLongPiece(): SettlementPiece {
    return piece({
        id: '1b8b6a3f-b5ca-46f7-9e0c-8cabfb838dd9',
        piece_type: 'long',
        status: 'produced',
        published_platforms: {},
        video_url: 'https://qjpujskwqaehxnqypxzu.supabase.co/storage/v1/object/public/media/longform/2026-07-24/1b8b6a3f.mp4',
    });
}

/** The exact faf48142 shape: 21 successful platform posts across 5 pieces,
 *  plus the 'long' that never fired. */
function frozenTopicPieces(): SettlementPiece[] {
    return [
        shipped('short_1'), shipped('short_2'), shipped('short_3'), shipped('short_4'),
        shipped('carousel', ['instagram']),
        lateLongPiece(),
    ];
}

describe('publisher reach — the settlement window mirrors daily-publish exactly', () => {
    it('uses the same 22h cutoff the publisher uses, one full tick later', () => {
        // The last piece slot is +10h, so the window always outlives every slot.
        expect(PUBLISHING_SELECTOR_CUTOFF_HOURS).toBeGreaterThan(MAX_SLOT_OFFSET_HOURS);
        expect(SETTLE_MARGIN_HOURS).toBeGreaterThanOrEqual(1);
    });

    // The whole safety argument is "the publisher can no longer select this
    // topic", so it has to be true of the real selector, not of a copy of it.
    it('never condemns a piece while selectPublishableTopics still returns the topic', () => {
        const row = {
            id: 't', title: 't', status: 'publishing',
            publish_at: PUBLISH_AT, publish_date: '2026-07-21', published_at: null,
        };
        for (let h = 0; h <= 40; h++) {
            const clock = at(h);
            const stillSelectable = selectPublishableTopics([row], clock).selected.length === 1;
            const condemns = isPieceUnfireable(lateLongPiece(), ctx(), clock) !== null;
            expect(stillSelectable && condemns).toBe(false);
        }
    });

    it('ends a publishing topic at publish_at + cutoff', () => {
        expect(publisherReachEnd(ctx())).toEqual(REACH_END);
        expect(isTopicPastPublisherReach(ctx(), REACH_END)).toBe(false);
        expect(isTopicPastPublisherReach(ctx(), SETTLE_TIME)).toBe(true);
    });

    // The calendar drag-and-drop + manual schedule path writes publish_date and
    // publish_time but never publish_at (33 of 98 live 'published' topics have
    // publish_at NULL). selectPublishableTopics returns those unconditionally
    // and isSlotReady fires every piece immediately, so the publisher's reach
    // is genuinely unbounded and nothing on them may ever be condemned.
    it('is unbounded for a publishing topic with publish_at NULL', () => {
        const c = ctx({ publish_at: null });
        expect(publisherReachEnd(c)).toBeNull();
        expect(isTopicPastPublisherReach(c, at(24 * 365))).toBe(false);
    });

    it('ends a partially_published topic at published_at + drain window', () => {
        const c = ctx({ status: 'partially_published', published_at: '2026-07-22T12:00:00.000Z' });
        const end = new Date(new Date('2026-07-22T12:00:00.000Z').getTime()
            + PARTIAL_DRAIN_WINDOW_DAYS * 24 * HOUR);
        expect(publisherReachEnd(c)).toEqual(end);
        expect(isTopicPastPublisherReach(c, new Date(end.getTime() - HOUR))).toBe(false);
        expect(isTopicPastPublisherReach(c, new Date(end.getTime() + 2 * HOUR))).toBe(true);
    });

    // selectPublishableTopics gates partially_published on
    // `published_at && published_at > sevenDaysAgo`, so a NULL published_at is
    // already unselectable — daily-publish sets that status without writing
    // published_at when a retry tick fails.
    it('treats a partially_published topic with no published_at as already unreachable', () => {
        const c = ctx({ status: 'partially_published', published_at: null });
        expect(isTopicPastPublisherReach(c, at(1))).toBe(true);
    });

    it('never condemns on an unparseable publish_at', () => {
        const c = ctx({ publish_at: 'not-a-date' });
        expect(publisherReachEnd(c)).toBeNull();
        expect(isTopicPastPublisherReach(c, NOW)).toBe(false);
    });
});

describe('classifyPlatformEntry', () => {
    it.each([
        [{ status: 'published' }, 'published'],
        [{ status: 'failed' }, 'failed'],
        [{ status: 'pending' }, 'pending'],
    ] as const)('maps %o to %s', (entry, expected) => {
        expect(classifyPlatformEntry(entry)).toBe(expected);
    });

    // The old code's resolution gate asked `!== 'pending'` while the tallies
    // only counted 'published'/'failed', so an unexpected value passed as
    // resolved and then counted for NEITHER — both totals stayed 0, no settle
    // branch matched, and the topic sat at 'publishing' with no status write.
    it('counts an unrecognized status as failed rather than as neither', () => {
        expect(classifyPlatformEntry({ status: 'skipped' })).toBe('failed');
        expect(classifyPlatformEntry({})).toBe('failed');
        expect(classifyPlatformEntry(null)).toBe('failed');
    });

    // Legacy flat-string shape from the 2026-07-10 backfill: { tiktok: "<id>" }.
    it('treats a bare post-id string as published', () => {
        expect(classifyPlatformEntry('7515111459437677866')).toBe('published');
        expect(classifyPlatformEntry('')).toBe('failed');
    });
});

describe('settleTopic — the 2026-07-21 frozen topic (faf48142, real row shape)', () => {
    it('condemns the long piece even though it HAS media and HAS targets', () => {
        const long = lateLongPiece();
        // Both piece-level tests the first fix relied on pass here.
        expect(long.video_url).toBeTruthy();
        const verdict = isPieceUnfireable(long, ctx(), NOW);
        expect(verdict).not.toBeNull();
        expect(verdict?.reason).toContain('never submitted');
    });

    it('settles instead of holding forever', () => {
        const result = settleTopic(frozenTopicPieces(), ctx(), NOW);

        expect(result.action).toBe('settle');
        if (result.action !== 'settle') return;
        expect(result.totalPublished).toBe(21); // 4 shorts x 5 platforms + carousel x 1
        expect(result.totalFailed).toBe(0);
        expect(result.unfireable).toHaveLength(1);
        expect(result.unfireable[0].id).toBe('1b8b6a3f-b5ca-46f7-9e0c-8cabfb838dd9');
        expect(result.neverFired).toBe(1);
    });

    // Every platform that was ever submitted succeeded, so the topic did
    // publish. The never-fired piece is reported (neverFired, the alert, and
    // the piece's own 'failed' row) but does not downgrade the topic: the old
    // code reached 'published' here, and 'published' is what gates the
    // newsletter draft and the COO publish report.
    it('settles published, with the missing piece reported rather than hidden', () => {
        const result = settleTopic(frozenTopicPieces(), ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('published');
        expect(result.neverFired).toBe(1);
    });

    it('holds while daily-publish can still reach the topic', () => {
        const result = settleTopic(frozenTopicPieces(), ctx(), REACH_END);

        expect(result.action).toBe('hold');
        if (result.action !== 'hold') return;
        expect(result.heldPieceIds).toEqual(['1b8b6a3f-b5ca-46f7-9e0c-8cabfb838dd9']);
    });

    it('settles exactly one publisher tick after the window closes', () => {
        expect(settleTopic(frozenTopicPieces(), ctx(), SETTLE_TIME).action).toBe('settle');
    });

    // The verdict must not flip between ticks: on the pass after settlement the
    // condemned piece is a terminally-failed piece, and both classifications
    // have to produce the same topic status or check-status rewrites the row
    // (and re-reports the topic as newly published) forever.
    it('produces the same verdict on the next tick, once the piece is marked failed', () => {
        const first = settleTopic(frozenTopicPieces(), ctx(), NOW);
        const afterMarking = frozenTopicPieces().map((p) =>
            p.id === '1b8b6a3f-b5ca-46f7-9e0c-8cabfb838dd9' ? { ...p, status: 'failed' } : p);
        const second = settleTopic(afterMarking, ctx({ status: 'published' }), at(24 * 30));

        if (first.action !== 'settle' || second.action !== 'settle') throw new Error('expected settle');
        expect(second.status).toBe(first.status);
        expect(second.neverFired).toBe(first.neverFired);
        expect(second.unfireable).toHaveLength(0); // nothing left to write
    });
});

describe('settleTopic — pieces that could still fire are NEVER marked failed', () => {
    it('holds a piece whose publish slot has not arrived yet', () => {
        // 09:00Z on publish day: short_1 (+0h) has not even opened.
        const early = new Date('2026-07-21T09:00:00.000Z');
        const pieces = [
            piece({ piece_type: 'short_1', video_url: null }),
            piece({ piece_type: 'long', video_url: null }),
        ];

        const result = settleTopic(pieces, ctx(), early);

        expect(result.action).toBe('hold');
        if (result.action !== 'hold') return;
        expect(result.heldPieceIds).toHaveLength(2);
    });

    // The renderer that caused this whole incident delivered 58 h late. Inside
    // the publish window a missing video is not a dead piece — daily-publish
    // fires it the moment the media lands. The first version of this fix
    // condemned short_1 at publish_date+12h, two hours before a 14:00Z HeyGen
    // render would have landed.
    it('holds a piece with no media at all while the topic is still selectable', () => {
        const noMedia = piece({ piece_type: 'short_1', video_url: null });
        // Long past its own slot (+0h) and past any per-piece grace window.
        expect(isPieceUnfireable(noMedia, ctx(), at(15))).toBeNull();
        expect(settleTopic([shipped('short_2'), noMedia], ctx(), at(15)).action).toBe('hold');
    });

    // A piece deferred by the rolling-24h provider cap keeps its media and its
    // targets, so the publisher retries it every hour until the window closes.
    // Re-introducing duplicate publishes (2026-06-02 / 2026-07-15) is far worse
    // than a topic that settles late.
    it('holds a cap-deferred piece until the publish window closes, then settles it', () => {
        const capDeferred = piece({
            piece_type: 'short_1',
            status: 'produced',
            video_url: 'https://cdn/ready.mp4', // media IS present
            published_platforms: {},            // never submitted: account at 24h cap
        });

        expect(isPieceUnfireable(capDeferred, ctx(), at(15))).toBeNull();
        expect(settleTopic([shipped('short_2'), capDeferred], ctx(), at(15)).action).toBe('hold');
        expect(settleTopic([shipped('short_2'), capDeferred], ctx(), NOW).action).toBe('settle');
    });

    it('holds when a fired piece still has a pending platform submission', () => {
        const stillPending = piece({
            piece_type: 'short_1',
            status: 'publishing',
            published_platforms: {
                tiktok: { status: 'published', post_id: 'a' },
                youtube: { status: 'pending', post_id: 'b' },
            },
        });

        const result = settleTopic([shipped('short_2'), stillPending], ctx(), NOW);

        expect(result.action).toBe('hold');
        if (result.action !== 'hold') return;
        expect(result.reason).toContain('pending');
        expect(result.heldPieceIds).toEqual([stillPending.id]);
    });

    // A 'publishing' topic with publish_at NULL is selected by daily-publish
    // with no upper bound, so its pieces are alive indefinitely — settlement
    // must never touch them no matter how old the row is.
    it('never condemns anything on a topic with no publish_at', () => {
        const pieces = [shipped('short_1'), piece({ piece_type: 'long', video_url: null })];
        const result = settleTopic(pieces, ctx({ publish_at: null }), at(24 * 90));
        expect(result.action).toBe('hold');
    });

    // Nothing published anywhere and a platform still under its retry budget:
    // daily-publish would keep retrying, and terminal 'failed' would drop the
    // topic out of the selector for good. That is the 2026-06-28 outage shape.
    it('holds a total-failure topic while a platform still has retry budget', () => {
        const retryable = piece({
            piece_type: 'short_1',
            published_platforms: { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
        });

        const result = settleTopic([retryable], ctx(), at(4));
        expect(result.action).toBe('hold');
        if (result.action !== 'hold') return;
        expect(result.reason).toContain('retry budget');
    });

    it('stops holding once the retry budget is exhausted', () => {
        const exhausted = piece({
            piece_type: 'short_1',
            published_platforms: {
                tiktok: { status: 'failed', error: '502', retry_count: MAX_PLATFORM_RETRIES },
            },
        });

        const result = settleTopic([exhausted], ctx(), at(4));
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('failed');
    });

    // Past the 'publishing' window with budget left, the topic is NOT dead —
    // daily-publish's scheduled/approved rule still reaches it for
    // MAX_SCHEDULED_AGE_DAYS from publish_date, and that rule is how the
    // publisher itself keeps a total-failure topic retryable
    // (`status: 'scheduled', 'Transient publish failure — retrying'`). Writing
    // terminal 'failed' here pre-empted it and killed a whole publish day with
    // 0 of MAX_PLATFORM_RETRIES spent — the 2026-06-28 outage shape, reached in
    // 10 minutes instead of over days.
    it('hands a total-failure topic back to scheduled instead of killing an unspent retry budget', () => {
        const retryable = piece({
            piece_type: 'short_1',
            published_platforms: { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
        });

        const result = settleTopic([retryable], ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('scheduled');
        // A hand-back must not condemn anything: the publisher is about to get
        // another go at every piece on the topic.
        expect(result.unfireable).toHaveLength(0);
    });

    // The 2026-06-28 shape exactly: every submission accepted, every post then
    // reported failed by Blotato with no retry_count at all. Catch-up publishing
    // puts publish_date 2 days back, so this lands past the 22 h window on the
    // FIRST settlement tick, 10 minutes after the only attempt.
    it('hands back a whole publish day whose first attempt failed on every platform', () => {
        const dead = (type: PieceType) => piece({
            piece_type: type,
            status: 'publishing',
            published_platforms: Object.fromEntries(
                ['tiktok', 'threads', 'twitter', 'youtube', 'instagram']
                    .map((p) => [p, { status: 'failed', post_id: `${type}-${p}`, error: 'Publishing failed' }]),
            ),
        });
        const pieces = [dead('short_1'), dead('short_2'), dead('short_3'), dead('short_4')];

        const result = settleTopic(pieces, ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('scheduled');
        expect(result.totalPublished).toBe(0);
        expect(result.totalFailed).toBe(20);
    });

    it('does settle failed once even the scheduled rule can no longer reach the topic', () => {
        const retryable = piece({
            piece_type: 'short_1',
            published_platforms: { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
        });

        // Past MAX_SCHEDULED_AGE_DAYS: selectPublishableTopics stale-skips the
        // row, so the budget can never be spent and holding for it is a latch.
        const result = settleTopic([retryable], ctx(), at(24 * (MAX_SCHEDULED_AGE_DAYS + 1)));
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('failed');
    });

    it('does settle failed when there is no publish_date for the scheduled rule to use', () => {
        const retryable = piece({
            piece_type: 'short_1',
            published_platforms: { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
        });

        const result = settleTopic([retryable], ctx({ publish_date: null }), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('failed');
    });

    // The hand-back is only correct if the publisher really would take the topic
    // back, so check it against the real selector rather than a restatement.
    it('hands back only when selectPublishableTopics would re-select the row as scheduled', () => {
        const retryable = piece({
            piece_type: 'short_1',
            published_platforms: { tiktok: { status: 'failed', error: '502', retry_count: 1 } },
        });

        for (let d = 0; d <= 6; d++) {
            const clock = at(24 * d + PUBLISHING_SELECTOR_CUTOFF_HOURS + SETTLE_MARGIN_HOURS + 1);
            const result = settleTopic([retryable], ctx(), clock);
            if (result.action !== 'settle') throw new Error('expected settle');
            const handedBack = { id: 't', title: 't', status: 'scheduled', publish_at: PUBLISH_AT, publish_date: '2026-07-21', published_at: null };
            const publisherTakesIt = selectPublishableTopics([handedBack], clock).selected.length === 1;
            expect(result.status === 'scheduled').toBe(publisherTakesIt);
        }
    });
});

describe('canPublisherRetryAsScheduled — the hand-back precondition', () => {
    it.each([
        ['inside the staleness window', ctx(), at(24), true],
        ['on the staleness boundary', ctx(), at(24 * MAX_SCHEDULED_AGE_DAYS), true],
        ['past the staleness window', ctx(), at(24 * (MAX_SCHEDULED_AGE_DAYS + 1)), false],
        ['with no publish_date for the DB pre-filter', ctx({ publish_date: null }), at(24), false],
        ['with publish_date in the future', ctx({ publish_date: '2026-08-01' }), at(24), false],
        ['with publish_at still in the future', ctx({ publish_at: '2026-07-30T13:00:00.000Z' }), at(24), false],
    ] as const)('%s → %s', (_label, c, clock, expected) => {
        expect(canPublisherRetryAsScheduled(c, clock)).toBe(expected);
    });

    // Same cross-check as the reach model: the rule has to agree with the real
    // selector, not with a restatement of it.
    it('agrees with selectPublishableTopics on a scheduled row', () => {
        for (let d = 0; d <= 6; d++) {
            const clock = at(24 * d);
            const row = { id: 't', title: 't', status: 'scheduled', publish_at: PUBLISH_AT, publish_date: '2026-07-21', published_at: null };
            expect(canPublisherRetryAsScheduled(ctx(), clock))
                .toBe(selectPublishableTopics([row], clock).selected.length === 1);
        }
    });
});

describe('publisher reach — the DB pre-filter is part of the publisher, not just the selector', () => {
    // daily-publish's hourly query is
    // `.in('status', […]).not('publish_date','is',null).lte('publish_date', today)`.
    // selectPublishableTopics only ever runs on rows that survived it, so a
    // reach model built from the selector alone reads a publish_date-less row
    // as "unbounded" when the cron in fact cannot see it at all. That is how a
    // manual "Publish Now" on one of the 8 live publish_date-NULL topics
    // latched at 'publishing' with nothing able to settle it.
    it('treats a publishing topic with no publish_date as already unreachable', () => {
        const c = ctx({ publish_date: null });
        expect(publisherReachEnd(c)).toEqual(new Date(0));
        expect(isTopicPastPublisherReach(c, at(1))).toBe(true);
    });

    it('treats a partially_published topic with no publish_date as already unreachable', () => {
        const c = ctx({ status: 'partially_published', publish_date: null, published_at: '2026-07-22T12:00:00.000Z' });
        expect(isTopicPastPublisherReach(c, at(24))).toBe(true);
    });

    it('still leaves scheduled/approved topics alone', () => {
        expect(publisherReachEnd(ctx({ status: 'scheduled', publish_date: null }))).toBeNull();
    });

    it('condemns a never-fired piece on a publish_date-less publishing topic', () => {
        // The per-piece slot guard still applies: at +11 h the long slot
        // (+10 h) has opened, so the only thing keeping the piece alive was the
        // (wrong) belief that the publisher could still come back for it.
        const result = settleTopic(frozenTopicPieces(), ctx({ publish_date: null }), at(11));
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.neverFired).toBe(1);
        expect(settleTopic(frozenTopicPieces(), ctx({ publish_date: null }), at(9)).action).toBe('hold');
    });
});

describe('publishAtRepair — bounding the unbounded publish_at-NULL window', () => {
    const DAY_END = new Date('2026-07-21T23:59:59.999Z');
    const repairDue = new Date(DAY_END.getTime() + PUBLISHING_SELECTOR_CUTOFF_HOURS * HOUR);

    it('does nothing while the topic still has a publish_at', () => {
        expect(publishAtRepair(ctx(), at(24 * 90))).toBeNull();
    });

    it('does nothing before the whole notional window has passed', () => {
        const c = ctx({ publish_at: null });
        expect(publishAtRepair(c, new Date(repairDue.getTime() - HOUR))).toBeNull();
    });

    // The repair anchors on the END of the publish day, so the window it grants
    // is never shorter than the real one — no fabricated midnight, no guessed
    // timezone conversion of publish_time.
    it('anchors to the end of the publish day once the window has passed', () => {
        const c = ctx({ publish_at: null });
        expect(publishAtRepair(c, repairDue)).toBe(DAY_END.toISOString());
    });

    // Every piece slot is open with publish_at NULL (isSlotReady returns true);
    // after the repair every slot must STILL be open, or the repair would
    // retro-actively gate a piece the publisher was about to fire.
    it('never closes a piece slot that was open before the repair', () => {
        const c = ctx({ publish_at: null });
        const anchor = publishAtRepair(c, repairDue)!;
        for (const type of Object.keys(PIECE_SLOT_OFFSET_HOURS) as PieceType[]) {
            expect(isSlotReady(type, anchor, repairDue)).toBe(true);
        }
    });

    // The point of writing the column rather than inventing a private anchor:
    // the publisher reads the same value, so both sides stop at the same instant.
    it('takes the topic out of selectPublishableTopics and lets settlement settle it', () => {
        const c = ctx({ publish_at: null });
        const anchor = publishAtRepair(c, repairDue)!;

        const before = { id: 't', title: 't', status: 'publishing', publish_at: null, publish_date: '2026-07-21', published_at: null };
        expect(selectPublishableTopics([before], repairDue).selected).toHaveLength(1);
        expect(settleTopic(frozenTopicPieces(), c, repairDue).action).toBe('hold');

        const after = { ...before, publish_at: anchor };
        expect(selectPublishableTopics([after], repairDue).selected).toHaveLength(0);
        const settled = settleTopic(
            frozenTopicPieces(),
            ctx({ publish_at: anchor }),
            new Date(repairDue.getTime() + (SETTLE_MARGIN_HOURS + 1) * HOUR),
        );
        expect(settled.action).toBe('settle');
    });

    it('repairs an unparseable publish_at, which holds exactly the same way', () => {
        const c = ctx({ publish_at: 'not-a-date' });
        expect(publisherReachEnd(c)).toBeNull();
        expect(publishAtRepair(c, repairDue)).toBe(DAY_END.toISOString());
    });

    it('has nothing to anchor on when publish_date is null too', () => {
        expect(publishAtRepair(ctx({ publish_at: null, publish_date: null }), at(24 * 90))).toBeNull();
    });

    it('leaves a partially_published topic to the drain-window rule', () => {
        const c = ctx({ status: 'partially_published', publish_at: null, published_at: '2026-07-22T12:00:00.000Z' });
        expect(publishAtRepair(c, at(24 * 90))).toBeNull();
    });
});

describe('settleTopic — un-fireable classification', () => {
    it('reports a missing media URL as the reason when that is the cause', () => {
        const noMedia = piece({ piece_type: 'long', video_url: null });
        expect(isPieceUnfireable(noMedia, ctx(), NOW)?.reason).toContain('no media URL');
    });

    it('reports zero configured target platforms as the reason when that is the cause', () => {
        // 'lecture' has a slot offset (+10h) but getTargetPlatforms has no case
        // for it and returns [] — it can never ship on any persona.
        const lecture = piece({ piece_type: 'lecture', video_url: 'https://cdn/lecture.mp4' });
        expect(isPieceUnfireable(lecture, ctx(), NOW)?.reason).toContain('no target platforms');
    });

    // The verdict is a property of the TOPIC being out of reach, so a broken
    // personas join changes only the wording, never the outcome.
    it('still condemns when the persona account map failed to load', () => {
        const p = piece({ piece_type: 'long', video_url: 'https://cdn/v.mp4' });
        expect(isPieceUnfireable(p, ctx({ accounts: null }), NOW)).not.toBeNull();
    });

    it('does not re-mark a piece that is already terminally failed', () => {
        const p = piece({ piece_type: 'long', status: 'failed', video_url: null });
        expect(isPieceUnfireable(p, ctx(), NOW)).toBeNull();
    });

    it('does not touch a piece that already fired', () => {
        const p = piece({
            piece_type: 'long',
            video_url: null,
            published_platforms: { tiktok: { status: 'failed', error: 'boom' } },
        });
        expect(isPieceUnfireable(p, ctx(), NOW)).toBeNull();
    });
});

describe('settleTopic — terminal statuses', () => {
    it('settles published when every platform on every piece succeeded', () => {
        const result = settleTopic([shipped('short_1'), shipped('short_2')], ctx(), NOW);

        expect(result.action).toBe('settle');
        if (result.action !== 'settle') return;
        expect(result.status).toBe('published');
        expect(result.unfireable).toHaveLength(0);
        expect(result.neverFired).toBe(0);
    });

    // daily-media marks a carousel piece 'failed' when 0 slides render,
    // explicitly so "check-status can still resolve the topic from the other
    // pieces", and the Blotato render poller does the same after MAX_RETRIES.
    // Those pieces were dead long before publishing and must not downgrade a
    // topic that shipped — doing so suppressed the newsletter draft and the COO
    // publish report, and left the topic pinned in the publisher's selector.
    it('settles published when a piece was already terminally failed upstream', () => {
        const pieces = [
            shipped('short_1'), shipped('short_2'),
            piece({ piece_type: 'carousel', status: 'failed', carousel_url: null, video_url: null }),
        ];

        const result = settleTopic(pieces, ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('published');
        expect(result.neverFired).toBe(1);
    });

    it('settles partially_published when some platforms failed', () => {
        const mixed = piece({
            piece_type: 'short_1',
            published_platforms: {
                tiktok: { status: 'published', post_id: 'a' },
                youtube: { status: 'failed', error: 'quota', retry_count: MAX_PLATFORM_RETRIES },
            },
        });

        const result = settleTopic([mixed], ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('partially_published');
        expect(result.totalPublished).toBe(1);
        expect(result.totalFailed).toBe(1);
    });

    it('settles failed when nothing published anywhere', () => {
        const allFailed = piece({
            piece_type: 'short_1',
            published_platforms: {
                tiktok: { status: 'failed', error: 'x', retry_count: MAX_PLATFORM_RETRIES },
                youtube: { status: 'failed', error: 'y', retry_count: MAX_PLATFORM_RETRIES },
            },
        });

        const result = settleTopic([allFailed], ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('failed');
    });

    // Previously: every piece terminally 'failed' with an empty platform map
    // produced totalPublished === 0 AND totalFailed === 0, which matched none
    // of the three branches, so no status was ever written and the topic sat
    // at 'publishing' forever.
    it('settles failed when every piece is terminally failed with an empty platform map', () => {
        const pieces = [
            piece({ piece_type: 'short_1', status: 'failed', published_platforms: {} }),
            piece({ piece_type: 'long', status: 'failed', published_platforms: {} }),
        ];

        const result = settleTopic(pieces, ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('failed');
        // Already terminal — no redundant piece writes requested.
        expect(result.unfireable).toHaveLength(0);
        expect(result.neverFired).toBe(2);
    });

    it('settles failed when every piece is un-fireable', () => {
        const pieces = [
            piece({ piece_type: 'short_1', video_url: null }),
            piece({ piece_type: 'long', video_url: null }),
        ];

        const result = settleTopic(pieces, ctx(), NOW);
        if (result.action !== 'settle') throw new Error('expected settle');
        expect(result.status).toBe('failed');
        expect(result.unfireable).toHaveLength(2);
        expect(result.neverFired).toBe(2);
    });

    it('holds a topic with no pieces rather than settling it', () => {
        expect(settleTopic([], ctx(), NOW).action).toBe('hold');
    });
});
