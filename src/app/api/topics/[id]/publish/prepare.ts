import type { SupabaseClient } from '@supabase/supabase-js';
import {
    isTopicPastPublisherReach,
    NEVER_FIRED_PREFIX,
    MAX_SLOT_OFFSET_HOURS,
    type SettlementContext,
} from '@/app/api/cron/check-status/settle';

/** Topic columns prepareManualPublish needs. */
export interface ManualPublishTopic {
    id: string;
    status: string;
    publish_at: string | null;
    publish_date: string | null;
    published_at: string | null;
}

export interface ManualPublishPrep {
    /** publish_at written onto the topic, if the window had to be re-opened. */
    reAnchoredPublishAt?: string;
    /** publish_date written onto the topic, if it had none. */
    reAnchoredPublishDate?: string;
    /** Pieces whose "never fired" condemnation was cleared for this run. */
    unCondemnedPieceIds?: string[];
}

/**
 * Make an operator's manual publish actually publishable, and safe against the
 * settlement pass, before publishTopic runs.
 *
 * TWO PROBLEMS, both found in the 2026-07-26 review of the settlement fix.
 *
 * 1. THE MANUAL PATH HAS NO PUBLISH WINDOW. POST /api/topics/[id]/publish calls
 *    publishTopic directly: no DB pre-filter, no selectPublishableTopics, no
 *    age bound. publishTopic then sets topics.status='publishing' and does NOT
 *    touch publish_at (nothing outside daily-topic/evergreen ever writes it;
 *    the schedule endpoint rewrites publish_date/publish_time only). So the
 *    instant an operator retried a topic older than the 22 h window, the
 *    settlement pass — which mirrors the publisher's reach — computed "this
 *    topic is already out of reach" WHILE the publish run was in flight, and
 *    was free to condemn every piece that run had not yet fired and to write a
 *    terminal status over it. Re-anchoring publish_at gives the manual run the
 *    same publish window a cron-scheduled topic gets, so the reach model tells
 *    the truth for both callers.
 *
 *    The anchor is `now - MAX_SLOT_OFFSET_HOURS`, not `now`: piece slots are
 *    offsets from publish_at (long is +10 h), and "Publish Now" must not turn
 *    into "publish short_1 now and the rest over the next ten hours". Backdating
 *    by the largest offset leaves every slot already open — exactly what these
 *    rows do today with publish_at NULL — while still giving the publisher
 *    PUBLISHING_SELECTOR_CUTOFF_HOURS - MAX_SLOT_OFFSET_HOURS ≈ 12 h of reach to
 *    finish the job (late render, draining provider cap, platform retries).
 *
 *    Only done when the cron cannot pick the topic up as it stands — including
 *    the case that latched 8 live rows: publish_at NULL, where the cron's reach
 *    is UNBOUNDED until check-status repairs the anchor, and publish_date NULL,
 *    where its query never returns the row at all. A topic being published on
 *    schedule satisfies every condition already and keeps its real publish_at,
 *    so nothing about the normal path moves.
 *
 * 2. A CONDEMNED PIECE IS NOT RE-FIRED BY THE PUBLISHER. daily-publish skips
 *    pieces at status='failed' with an empty platform map — that is what makes
 *    the settlement pass's condemnation mean anything at all. An explicit
 *    operator retry is precisely the event that should overturn it: the render
 *    that was missing has landed, or the capped account has drained. Clearing
 *    the marker (and only the settlement's own marker) is the recovery path.
 */
export async function prepareManualPublish(
    supabase: SupabaseClient,
    topic: ManualPublishTopic,
    now: Date = new Date(),
): Promise<ManualPublishPrep> {
    const prep: ManualPublishPrep = {};

    // ── 1. Re-open the publish window when it has closed ──────────────────
    const ctx: SettlementContext = {
        status: topic.status,
        publish_at: topic.publish_at,
        publish_date: topic.publish_date,
        published_at: topic.published_at,
        accounts: null,
    };
    // Every condition daily-publish's hourly tick imposes, in order: the status
    // its query asks for, the publish_date its query requires, an anchor the
    // reach model can actually read, and the reach itself. A topic being
    // published on schedule satisfies all four and is left completely alone.
    const anchorUsable = topic.publish_at !== null && !Number.isNaN(new Date(topic.publish_at).getTime());
    const cronCanReach =
        ['scheduled', 'approved', 'publishing', 'partially_published'].includes(topic.status)
        && Boolean(topic.publish_date)
        && anchorUsable
        && !isTopicPastPublisherReach(ctx, now);

    if (!cronCanReach) {
        const anchor = new Date(now.getTime() - MAX_SLOT_OFFSET_HOURS * 60 * 60 * 1000).toISOString();
        const update: Record<string, unknown> = { publish_at: anchor };
        prep.reAnchoredPublishAt = anchor;
        // The publisher's DB pre-filter is `publish_date IS NOT NULL AND
        // publish_date <= today`; a row without one is invisible to every
        // future tick no matter what publish_at says.
        if (!topic.publish_date) {
            const today = now.toISOString().split('T')[0];
            update.publish_date = today;
            prep.reAnchoredPublishDate = today;
        }
        await supabase.from('topics').update(update).eq('id', topic.id);
    }

    // ── 2. Un-condemn pieces the settlement pass marked "never fired" ──────
    const { data: failedPieces } = await supabase
        .from('content_pieces')
        .select('id, status, error_message, published_platforms')
        .eq('topic_id', topic.id)
        .eq('status', 'failed');

    const unCondemned: string[] = [];
    for (const piece of (failedPieces ?? []) as Array<{
        id: string;
        error_message: string | null;
        published_platforms: unknown;
    }>) {
        const entries = Object.keys((piece.published_platforms ?? {}) as Record<string, unknown>);
        if (entries.length > 0) continue; // it fired; not a settlement condemnation
        if (!String(piece.error_message ?? '').startsWith(NEVER_FIRED_PREFIX)) continue;
        await supabase
            .from('content_pieces')
            .update({ status: 'produced', error_message: null })
            .eq('id', piece.id);
        unCondemned.push(piece.id);
    }
    if (unCondemned.length > 0) prep.unCondemnedPieceIds = unCondemned;

    return prep;
}
