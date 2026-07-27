import {
    getMediaUrl,
    getConfiguredTargetPlatforms,
    pieceSlotTime,
    PIECE_SLOT_OFFSET_HOURS,
    PUBLISHING_SELECTOR_CUTOFF_HOURS,
    PARTIAL_DRAIN_WINDOW_DAYS,
    MAX_PLATFORM_RETRIES,
    MAX_SCHEDULED_AGE_DAYS,
} from '../daily-publish/helpers';
import type { PieceType, PlatformAccounts } from '@/types/database';

/**
 * Topic settlement decision logic for the check-status cron.
 *
 * Extracted as a pure module (same pattern as selectPublishableTopics /
 * countPlatformOutcomes / hasRetryablePlatform in daily-publish/route.ts) so
 * the 2026-07-21 freeze can be unit-tested without a Supabase stub.
 *
 * THE 2026-07-21 FREEZE (topic faf48142-0330-4b14-8304-e03fefbf8369).
 * The old promotion rule was "hold until EVERY piece has fired or is
 * terminally failed". That rule has no expiry, and daily-publish has no
 * piece-level terminal-failure state: every skip that returns before its
 * content_pieces write (slot not ready, no media URL, no target platforms,
 * provider 24 h cap) leaves the piece at published_platforms = {} with a
 * non-'failed' status — permanently matching the hold predicate. On
 * 2026-07-21 Dr. Imani Carter's 'long' piece had no video at its 23:00Z slot
 * (the external local renderer delivered it 58 h later, 2026-07-24 09:32Z).
 * Five pieces shipped, the sixth never fired, and the topic latched at
 * status='publishing' with published_at NULL.
 *
 * WHY THE FIRST ATTEMPT AT THIS FIX MISSED IT (2026-07-26 review). The first
 * version condemned a never-fired piece only when it had NO media URL or NO
 * configured target platforms. But by the time anything ran, the late render
 * HAD landed: content_pieces.video_url on 1b8b6a3f… is a real storage URL, and
 * Dr. Carter's persona has five connected accounts, so 'long' resolves to
 * three targets. The piece failed neither test, held forever, and the topic
 * stayed exactly as frozen as before.
 *
 * The piece is not dead because of anything ON the piece. It is dead because
 * of the TOPIC: daily-publish's selector stopped returning it. publishTopic is
 * never invoked for that topic again, so media and targets are irrelevant —
 * nothing can fire any of its pieces, ever. That is the real predicate, and it
 * is the one implemented below: a never-fired piece is un-fireable exactly
 * when the topic has passed the end of daily-publish's own reach.
 */

/**
 * Safety margin (hours) added to the end of the publisher's reach before a
 * never-fired piece may be called terminally dead.
 *
 * daily-publish runs hourly and check-status every 10 minutes, with no shared
 * lock between them. One full publisher tick of margin guarantees the last
 * possible publish attempt has completed and written its row before settlement
 * looks at it, so we can never mark a piece 'failed' while a submission for it
 * is in flight.
 */
export const SETTLE_MARGIN_HOURS = 1;

/**
 * How long a topic may sit in the settlement pass's HOLD state before a human
 * is told about it.
 *
 * Every hold is legitimate at the instant it is taken (a piece can still fire,
 * a submission is still pending at Blotato, a retry budget is unspent), but a
 * hold that never resolves is the 2026-07-21 freeze by another name — and that
 * freeze was silent for 5 days. One full publish day (the last slot is +10 h,
 * the selector window is 22 h) plus a margin is comfortably longer than any
 * healthy hold.
 */
export const STUCK_HOLD_ALERT_HOURS = 26;

/** Prefix on content_pieces.error_message for a piece the settlement pass
 *  condemned. Shared vocabulary: daily-publish refuses to re-fire a condemned
 *  piece, and the manual publish endpoint clears exactly this marker when an
 *  operator asks for a retry. */
export const NEVER_FIRED_PREFIX = 'Never fired —';

/** Minimal content_pieces row shape the settlement rules need. */
export interface SettlementPiece {
    id: string;
    piece_type: PieceType;
    status: string | null;
    published_platforms: unknown;
    video_url: string | null;
    carousel_url: string | null;
}

/** Topic/persona context needed to decide whether a piece could still fire. */
export interface SettlementContext {
    /** topics.status — decides WHICH selector rule bounds the publisher's
     *  reach (the 'publishing' rule and the 'partially_published' rule are
     *  different windows anchored on different columns). */
    status: string | null;
    publish_at: string | null;
    publish_date: string | null;
    /** topics.published_at — anchors the partially_published drain window. */
    published_at: string | null;
    /** persona.platform_accounts. Only used to phrase the failure reason. */
    accounts: PlatformAccounts | null | undefined;
    facebook?: { enabled?: boolean | null; pageIds?: string[] | null };
}

/** A piece that can never fire, with the reason recorded for its error_message. */
export interface UnfireablePiece {
    id: string;
    reason: string;
}

export type TopicSettlement =
    | { action: 'hold'; reason: string; heldPieceIds: string[] }
    | {
          action: 'settle';
          /** 'scheduled' is a HAND-BACK, not a terminal verdict: nothing
           *  published, a platform still has retry budget, and daily-publish
           *  can still select the topic under its scheduled/approved rule. It
           *  writes no published_at and condemns no pieces. */
          status: 'published' | 'partially_published' | 'failed' | 'scheduled';
          totalPublished: number;
          totalFailed: number;
          /** Pieces the caller should now mark content_pieces.status='failed'
           *  so they stop blocking, and become visible in the review UI. */
          unfireable: UnfireablePiece[];
          /** Every piece that shipped nothing anywhere — the ones condemned on
           *  THIS pass plus the ones already terminally failed with an empty
           *  platform map. Stable across ticks (unlike `unfireable`, which is
           *  non-empty only on the pass that condemns), so it is what the
           *  caller puts in topics.error_message. */
          neverFired: number;
      };

type PlatformOutcome = 'published' | 'failed' | 'pending';

/**
 * Classify one published_platforms entry. EXHAUSTIVE by construction.
 *
 * The old code split this in two and the halves disagreed: the resolution gate
 * asked `status !== 'pending'` while the tallies only counted exactly
 * 'published' or 'failed'. Any other value (hand-edited row, a future Blotato
 * state) passed as "resolved" and then contributed to neither counter, so both
 * totals stayed 0, every settle branch was skipped, and the topic sat at
 * 'publishing' with no status write at all. One function, three outcomes.
 *
 * Exported for unit testing.
 */
export function classifyPlatformEntry(entry: unknown): PlatformOutcome {
    // Legacy flat-string shape from the 2026-07-10 backfill:
    // { "tiktok": "7515111459437677866" }. A bare post id means it shipped.
    if (typeof entry === 'string') return entry.trim() ? 'published' : 'failed';
    if (!entry || typeof entry !== 'object') return 'failed';
    const status = (entry as { status?: unknown }).status;
    if (status === 'published') return 'published';
    if (status === 'pending') return 'pending';
    return 'failed';
}

function platformEntries(publishedPlatforms: unknown): unknown[] {
    if (!publishedPlatforms || typeof publishedPlatforms !== 'object') return [];
    return Object.values(publishedPlatforms as Record<string, unknown>);
}

/** A parsed timestamp, or null when the column is null/unparseable. Never
 *  returns an Invalid Date — a garbage timestamp must read as "unknown", which
 *  everything below treats as "keep holding". */
function parseTime(value: string | null | undefined): number | null {
    if (!value) return null;
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
}

/**
 * The instant after which daily-publish's selector will never return this
 * topic again. `null` means "no upper bound" — the publisher keeps picking it
 * up indefinitely, so nothing on it may ever be declared dead.
 *
 * This MIRRORS daily-publish's hourly tick exactly — BOTH halves of it, using
 * that module's own constants:
 *
 *  1. The DB pre-filter, `.not('publish_date','is',null).lte('publish_date',
 *     today)`. A row with publish_date NULL is never returned by the hourly
 *     query at all, whatever its status, so the cron's reach for it ended when
 *     it entered that status. Modelling only selectPublishableTopics (which
 *     runs on rows the query already narrowed) read those rows as unbounded and
 *     held them forever — the manual "Publish Now" path reaches this state,
 *     because it calls publishTopic directly and 8 live 'scheduled' topics have
 *     publish_date NULL (2026-07-26 review).
 *
 *  2. selectPublishableTopics itself:
 *  - 'publishing'           → publish_at + PUBLISHING_SELECTOR_CUTOFF_HOURS.
 *    With publish_at NULL the selector returns true unconditionally
 *    (`if (!t.publish_at) return true`) and isSlotReady fires every piece
 *    immediately, so the reach is genuinely unbounded and NOTHING here may
 *    condemn — the fabricated "publish_date at midnight UTC" anchor the first
 *    version of this file used would have condemned live pieces hours before
 *    their media arrived. That unbounded state is not left to stand: the
 *    caller repairs the missing anchor (see publishAtRepair below), which
 *    bounds the publisher and this module in the same write.
 *  - 'partially_published'  → published_at + PARTIAL_DRAIN_WINDOW_DAYS.
 *    published_at NULL fails that gate outright (`Boolean(t.published_at && …)`),
 *    so such a topic is already unreachable — reach ended at the epoch.
 *  - anything else (scheduled/approved/…) → not our business; unbounded.
 *
 * Exported for unit testing.
 */
export function publisherReachEnd(ctx: SettlementContext): Date | null {
    const isOpenStatus = ctx.status === 'publishing' || ctx.status === 'partially_published';
    // The DB pre-filter excludes the row entirely — no selector rule below can
    // bring it back, so reach ended before any of them are consulted.
    if (isOpenStatus && !ctx.publish_date) return new Date(0);

    if (ctx.status === 'partially_published') {
        const publishedAt = parseTime(ctx.published_at);
        if (publishedAt === null) return new Date(0);
        return new Date(publishedAt + PARTIAL_DRAIN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    }
    if (ctx.status !== 'publishing') return null;
    const publishAt = parseTime(ctx.publish_at);
    if (publishAt === null) return null;
    return new Date(publishAt + PUBLISHING_SELECTOR_CUTOFF_HOURS * 60 * 60 * 1000);
}

/** Midnight-to-midnight end of a publish_date, in UTC. Null when the column is
 *  null or unparseable. Exported for unit testing. */
export function publishDayEnd(publishDate: string | null): Date | null {
    if (!publishDate) return null;
    const t = new Date(`${publishDate}T23:59:59.999Z`).getTime();
    return Number.isNaN(t) ? null : new Date(t);
}

/**
 * The publish_at value the caller should write onto a 'publishing' topic that
 * has none — or `null` when the row must be left alone.
 *
 * WHY THIS EXISTS. A 'publishing' topic with publish_at NULL is returned by
 * selectPublishableTopics unconditionally and forever
 * (`if (!t.publish_at) return true`, ahead of every staleness gate). That is
 * the same 2026-07-21 freeze on a different anchor, and strictly worse:
 * publisherReachEnd is unbounded so settlement holds for all time, while the
 * publisher re-selects the topic on every hourly tick, burning one of
 * MAX_TOPICS_PER_TICK = 5 slots and (with a few such rows) starving genuinely
 * scheduled topics outright. 33 of 98 live 'published' topics went through
 * this calendar/manual path, which writes publish_date + publish_time but
 * never publish_at.
 *
 * The fix is to repair the missing anchor rather than to invent one only this
 * module believes in: writing publish_at bounds the PUBLISHER (its selector
 * reads the same column) and this module in a single write, so the two can
 * never disagree about reach. Deliberately conservative:
 *  - anchored at the END of the publish day (23:59:59.999Z), never at a
 *    fabricated midnight or a guessed timezone conversion of publish_time, so
 *    the repaired window is never shorter than the real one;
 *  - only once the whole notional window (publish day + the selector's 22 h)
 *    is already past, so no piece slot can be retro-actively closed: with
 *    publish_at NULL every slot is open (isSlotReady returns true), and after
 *    the repair every slot is still open (the largest offset is +10 h);
 *  - applied to an UNPARSEABLE publish_at as well as a NULL one: both make
 *    publisherReachEnd unbounded, so both latch in exactly the same way.
 *
 * Exported for unit testing.
 */
export function publishAtRepair(ctx: SettlementContext, now: Date): string | null {
    if (ctx.status !== 'publishing') return null;
    if (parseTime(ctx.publish_at) !== null) return null;
    const dayEnd = publishDayEnd(ctx.publish_date);
    if (dayEnd === null) return null; // no anchor to derive; reach already ended
    if (now.getTime() < dayEnd.getTime() + PUBLISHING_SELECTOR_CUTOFF_HOURS * 60 * 60 * 1000) {
        return null;
    }
    return dayEnd.toISOString();
}

/**
 * True when handing the topic back to 'scheduled' really would put it back
 * inside daily-publish's reach, so an unspent per-platform retry budget can
 * still be spent.
 *
 * Mirrors the publisher's scheduled/approved path exactly: the DB pre-filter
 * (publish_date NOT NULL and <= today) plus selectPublishableTopics' staleness
 * lower bound (publish_date >= now - MAX_SCHEDULED_AGE_DAYS) and its publish_at
 * gate (publish_at <= now).
 *
 * Exported for unit testing.
 */
export function canPublisherRetryAsScheduled(ctx: SettlementContext, now: Date): boolean {
    if (!ctx.publish_date) return false;
    const today = now.toISOString().split('T')[0];
    if (ctx.publish_date > today) return false;
    const staleCutoff = new Date(now.getTime() - MAX_SCHEDULED_AGE_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
    if (ctx.publish_date < staleCutoff) return false;
    const publishAt = parseTime(ctx.publish_at);
    if (publishAt !== null && publishAt > now.getTime()) return false;
    return true;
}

/** True once the publisher can no longer reach this topic (plus one tick of
 *  margin). Exported for unit testing. */
export function isTopicPastPublisherReach(ctx: SettlementContext, now: Date): boolean {
    const end = publisherReachEnd(ctx);
    if (end === null) return false;
    return now.getTime() >= end.getTime() + SETTLE_MARGIN_HOURS * 60 * 60 * 1000;
}

/** Why a piece that never fired never fired — diagnosis only, for the row's
 *  error_message and the alert email. The VERDICT never depends on this. */
function describeNeverFired(piece: SettlementPiece, ctx: SettlementContext): string {
    if (getMediaUrl(piece) === null) {
        return 'no media URL before the topic left daily-publish\'s publish window';
    }
    if (ctx.accounts) {
        const targets = getConfiguredTargetPlatforms(piece.piece_type, ctx.accounts, ctx.facebook);
        if (targets.length === 0) {
            return `no target platforms configured for piece type '${piece.piece_type}'`;
        }
    }
    // Media and targets are both fine — this is the faf48142 shape: the media
    // landed after the publish window closed, or the piece was deferred by the
    // rolling-24h provider cap until the window closed.
    return 'media arrived after the topic left daily-publish\'s publish window (never submitted)';
}

/**
 * True when a piece that has never fired can never fire.
 *
 * The single sufficient condition is that the TOPIC is past the end of
 * daily-publish's reach: selectPublishableTopics no longer returns it, so
 * publishTopic is never invoked for it, so no piece of it can be submitted
 * regardless of media, targets, or provider caps.
 *
 * Deliberately NOT un-fireable:
 *  - any piece on a topic the publisher can still select — including one with
 *    no media and one deferred by the rolling-24h provider cap. Inside the
 *    window the renderer can still deliver and the cap can still drain, and
 *    "losing a publishable piece is worse than settling late" (2026-06-02 /
 *    2026-07-15 duplicate-publish incidents);
 *  - any piece on a topic with an unbounded window (a 'publishing' topic with
 *    publish_at NULL — the calendar/manual schedule path writes publish_date
 *    and publish_time but no publish_at, and 33 of 98 published topics in the
 *    live DB have publish_at NULL);
 *  - a piece whose own slot has not arrived (belt and braces: the last slot is
 *    +10 h and the window closes at +22 h, so this cannot happen for a
 *    'publishing' topic — but a hand-edited row must not slip through).
 *
 * Exported for unit testing.
 */
export function isPieceUnfireable(
    piece: SettlementPiece,
    ctx: SettlementContext,
    now: Date = new Date(),
): UnfireablePiece | null {
    // Only pieces that never fired anywhere are candidates.
    if (platformEntries(piece.published_platforms).length > 0) return null;
    // Already terminal — nothing to re-mark.
    if (piece.status === 'failed') return null;

    if (!isTopicPastPublisherReach(ctx, now)) return null;

    const slot = pieceSlotTime(piece.piece_type, ctx.publish_at);
    if (slot && now.getTime() < slot.getTime()) return null;

    return { id: piece.id, reason: describeNeverFired(piece, ctx) };
}

/** True if any platform entry failed with retry budget left, i.e. the publisher
 *  would still retry it. Mirrors hasRetryablePlatform in daily-publish. */
function hasPlatformRetryBudget(pieces: SettlementPiece[]): boolean {
    for (const piece of pieces) {
        for (const entry of platformEntries(piece.published_platforms)) {
            if (classifyPlatformEntry(entry) !== 'failed') continue;
            const retries = (entry as { retry_count?: unknown })?.retry_count;
            const count = typeof retries === 'number' ? retries : 0;
            if (count < MAX_PLATFORM_RETRIES) return true;
        }
    }
    return false;
}

/**
 * Decide whether a topic can settle now, and to what status.
 *
 * Hold (still the default) when:
 *  - any piece has not fired but could still fire, or
 *  - any fired piece has a platform submission still 'pending' at Blotato, or
 *  - nothing succeeded anywhere but a failed platform still has retry budget
 *    AND the publisher can still reach the topic — writing terminal 'failed'
 *    there would throw away MAX_PLATFORM_RETRIES attempts, which is exactly
 *    what silently killed days of content in the 2026-06-28 Blotato outage.
 *    daily-publish guards its own 'failed' write with hasRetryablePlatform;
 *    check-status now guards the same write the same way.
 *
 * Settle when every piece is accounted for:
 *  - published            — at least one platform succeeded and none failed;
 *  - partially_published  — at least one platform succeeded, some failed;
 *  - scheduled            — nothing succeeded, retry budget remains, and the
 *                           publisher's scheduled rule can still reach the
 *                           topic. A hand-back, not a verdict;
 *  - failed               — nothing succeeded anywhere and no retry left that
 *                           anything could ever spend.
 *
 * Pieces that shipped NOTHING (condemned on this pass, or already terminally
 * failed by daily-media / the Blotato render poller) are reported as
 * `neverFired` and alerted on, but they do NOT downgrade published →
 * partially_published. That matches the pre-fix behaviour (the old code
 * filtered those pieces out of both tallies) and it matters twice over:
 * 'published' is what gates the newsletter draft and the COO publish report,
 * and — unlike 'partially_published' — it is terminal, so a topic that shipped
 * 5 of 6 pieces leaves the publisher's selector instead of occupying one of
 * MAX_TOPICS_PER_TICK slots forever. It also keeps the verdict STABLE across
 * ticks: a piece condemned on one pass is a dead piece on the next, and both
 * classifications now produce the same topic status.
 *
 * `now` is injectable for deterministic tests, matching selectPublishableTopics.
 * Exported for unit testing.
 */
export function settleTopic(
    pieces: SettlementPiece[],
    ctx: SettlementContext,
    now: Date = new Date(),
): TopicSettlement {
    if (pieces.length === 0) {
        // daily-publish already marks piece-less topics failed; nothing to do.
        return { action: 'hold', reason: 'topic has no content pieces', heldPieceIds: [] };
    }

    const held: string[] = [];
    const pendingPieceIds = new Set<string>();
    const unfireable: UnfireablePiece[] = [];
    /** Pieces already marked terminally failed with nothing ever submitted
     *  (daily-media's 0-slide carousel, the Blotato render poller's
     *  MAX_RETRIES exit, or a piece this pass condemned on an earlier tick).
     *  They ship nothing, but need no further write. */
    let deadPieces = 0;
    let totalPublished = 0;
    let totalFailed = 0;

    for (const piece of pieces) {
        const entries = platformEntries(piece.published_platforms);

        if (entries.length === 0) {
            if (piece.status === 'failed') {
                deadPieces++;
                continue;
            }
            const verdict = isPieceUnfireable(piece, ctx, now);
            if (verdict) {
                unfireable.push(verdict);
                continue;
            }
            held.push(piece.id);
            continue;
        }

        for (const entry of entries) {
            const outcome = classifyPlatformEntry(entry);
            if (outcome === 'pending') pendingPieceIds.add(piece.id);
            else if (outcome === 'published') totalPublished++;
            else totalFailed++;
        }
    }

    if (held.length > 0) {
        return {
            action: 'hold',
            reason: `${held.length} piece(s) have not fired yet and can still fire`,
            heldPieceIds: held,
        };
    }
    if (pendingPieceIds.size > 0) {
        return {
            action: 'hold',
            reason: `${pendingPieceIds.size} piece(s) have platform submissions still pending at Blotato`,
            heldPieceIds: [...pendingPieceIds],
        };
    }

    const neverFired = unfireable.length + deadPieces;
    if (totalPublished === 0 && totalFailed === 0 && neverFired === 0) {
        // No resolved outcome anywhere — nothing to settle on yet.
        return { action: 'hold', reason: 'no resolved platform outcomes yet', heldPieceIds: [] };
    }

    if (totalPublished === 0 && hasPlatformRetryBudget(pieces)) {
        // The publisher is still on it — leave it entirely alone.
        if (!isTopicPastPublisherReach(ctx, now)) {
            return {
                action: 'hold',
                reason: 'nothing published yet, but a failed platform still has retry budget and daily-publish can still reach this topic',
                heldPieceIds: [],
            };
        }
        // Out of reach as 'publishing'/'partially_published', but the budget is
        // real and daily-publish's scheduled rule would still pick the topic
        // up. Hand it back instead of terminating it.
        //
        // Writing 'failed' here was the 2026-06-28 outage in miniature: a whole
        // publish day can reach this branch 10 minutes after its first attempt
        // with 0 of MAX_PLATFORM_RETRIES spent (every submission accepted, then
        // every post reported failed by Blotato), and 'failed' is excluded from
        // the publisher's query, so the topic is dead forever. daily-publish's
        // own equivalent path deliberately writes 'scheduled', not 'failed';
        // check-status now agrees with it (2026-07-26 review).
        if (canPublisherRetryAsScheduled(ctx, now)) {
            return {
                action: 'settle',
                status: 'scheduled',
                totalPublished,
                totalFailed,
                // Nothing is condemned on a hand-back: the publisher is about to
                // get another go at every piece, so marking any of them dead
                // would contradict the write in the very same pass.
                unfireable: [],
                neverFired,
            };
        }
        // Budget left, but nothing will ever spend it (publish_date NULL, in
        // the future, or past MAX_SCHEDULED_AGE_DAYS). Holding for a budget
        // that can never be spent is just another latch — settle below.
    }

    const status: 'published' | 'partially_published' | 'failed' =
        totalPublished === 0
            ? 'failed'
            : totalFailed > 0
                ? 'partially_published'
                : 'published';

    return { action: 'settle', status, totalPublished, totalFailed, unfireable, neverFired };
}

/** Re-exported so the reach derivation stays checkable from the tests. */
export const MAX_SLOT_OFFSET_HOURS = Math.max(...Object.values(PIECE_SLOT_OFFSET_HOURS));
export { PUBLISHING_SELECTOR_CUTOFF_HOURS, PARTIAL_DRAIN_WINDOW_DAYS, MAX_PLATFORM_RETRIES };
