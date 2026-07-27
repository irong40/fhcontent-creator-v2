import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { claude } from '@/lib/claude';
import { buildNewsletterDraftPrompt } from '@/lib/prompts';
import { estimateClaudeCost } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { cleanStaleLocks } from '@/lib/workflow-lock';
import { logPublishReport } from '@/lib/coo-report';
import { validateCronSecret } from '../middleware';
import {
    settleTopic,
    classifyPlatformEntry,
    publishAtRepair,
    publishDayEnd,
    NEVER_FIRED_PREFIX,
    STUCK_HOLD_ALERT_HOURS,
    type SettlementPiece,
} from './settle';
import type { PublishedPlatforms, PlatformStatus, TopicWithPersona, PlatformAccounts } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 300;

const MAX_RETRIES = 3;

interface BlotatoVideoPollResult {
    checked: number;
    completed: number;
    failed: number;
    stillProcessing: number;
}

async function pollBlotatoVideoStatuses(supabase: SupabaseClient): Promise<BlotatoVideoPollResult | null> {
    const { data: pendingPieces, error } = await supabase
        .from('content_pieces')
        .select('id, topic_id, piece_type, blotato_job_id, retry_count')
        .eq('blotato_status', 'processing')
        .not('blotato_job_id', 'is', null);

    if (error) throw new Error(error.message);
    if (!pendingPieces || pendingPieces.length === 0) return null;

    let completed = 0;
    let failed = 0;
    let stillProcessing = 0;

    for (const piece of pendingPieces) {
        try {
            const status = await blotato.getVideoStatus(piece.blotato_job_id!);

            if (status.item.status.toLowerCase() === 'done') {
                await supabase
                    .from('content_pieces')
                    .update({
                        video_url: status.item.mediaUrl,
                        blotato_status: 'done',
                        status: 'produced',
                        produced_at: new Date().toISOString(),
                    })
                    .eq('id', piece.id);
                completed++;
            } else if (status.item.status.toLowerCase() === 'failed') {
                const retryCount = piece.retry_count ?? 0;
                if (retryCount < MAX_RETRIES) {
                    await supabase
                        .from('content_pieces')
                        .update({
                            blotato_status: null,
                            blotato_job_id: null,
                            retry_count: retryCount + 1,
                            error_message: 'Blotato video rendering failed',
                        })
                        .eq('id', piece.id);
                } else {
                    await supabase
                        .from('content_pieces')
                        .update({
                            blotato_status: 'failed',
                            status: 'failed',
                            error_message: `Blotato failed after ${MAX_RETRIES} retries`,
                        })
                        .eq('id', piece.id);
                    await notifyError({
                        source: 'check-status',
                        message: `Blotato video failed after ${MAX_RETRIES} retries`,
                        topicId: piece.topic_id,
                    });
                }
                failed++;
            } else {
                stillProcessing++;
            }
        } catch (e) {
            console.error(`Error checking Blotato video status for piece ${piece.id}:`, e);
            failed++;
        }
    }

    return { checked: pendingPieces.length, completed, failed, stillProcessing };
}

interface BlotatoPollResult {
    checked: number;
    published: number;
    failed: number;
    stillPending: number;
    newlyPublishedTopicIds: string[];
    /** Topic rows the settlement pass actually wrote this tick. A re-settle
     *  that computes the same verdict writes nothing and is not counted. */
    topicsSettled: number;
    /** Pieces marked terminally failed because they could never fire: they
     *  never reached any platform and the topic has left daily-publish's
     *  selector window, so no tick will ever submit them. */
    unfireablePieces: number;
    /** Topics handed back to 'scheduled' with their per-platform retry budget
     *  intact instead of being terminally failed. */
    topicsHandedBack: number;
    /** 'publishing' topics that had no publish_at and were given one, so the
     *  publisher's selector (and this pass) finally have an upper bound. */
    anchorsRepaired: number;
    /** Topics held so long that a human was alerted. */
    stuckTopics: number;
}

/** Topic row shape the settlement pass needs. published_at and error_message
 *  are read (not just written) so a re-settle that computes the SAME verdict
 *  writes nothing — see the idempotence guard below. */
interface SettleTopicRow {
    id: string;
    status: string;
    publish_at: string | null;
    publish_date: string | null;
    published_at: string | null;
    error_message: string | null;
    personas: {
        name?: string | null;
        platform_accounts?: unknown;
        facebook_enabled?: boolean | null;
        facebook_page_ids?: string[] | null;
    } | null;
}

/** Poll in-flight Blotato submissions, then reconcile every unsettled topic.
 *  `now` is injectable for deterministic tests, matching selectPublishableTopics
 *  in daily-publish. Exported for unit testing (2026-07-21 freeze regression). */
export async function pollBlotatoStatuses(
    supabase: SupabaseClient,
    now: Date = new Date(),
): Promise<BlotatoPollResult> {
    const result: BlotatoPollResult = {
        checked: 0, published: 0, failed: 0, stillPending: 0,
        newlyPublishedTopicIds: [], topicsSettled: 0, unfireablePieces: 0,
        topicsHandedBack: 0, anchorsRepaired: 0, stuckTopics: 0,
    };

    const { data: publishingPieces } = await supabase
        .from('content_pieces')
        .select('id, topic_id, published_platforms')
        .eq('status', 'publishing');

    // NOTE: there is deliberately no early return when this poll comes back
    // empty. Until 2026-07-21 this function bailed here, so the topic
    // settlement pass below never ran on a quiet tick — that was half of the
    // faf48142 latch (see settle.ts). Settlement is now seeded from
    // topics.status and must run whether or not a piece is mid-flight.
    for (const piece of publishingPieces ?? []) {
        const platforms = (piece.published_platforms || {}) as PublishedPlatforms;
        let pieceUpdated = false;
        let allResolved = true;
        const updatedPlatforms = { ...platforms } as Record<string, PlatformStatus>;

        for (const [platform, pStatus] of Object.entries(platforms)) {
            const ps = pStatus as PlatformStatus;
            if (ps.status !== 'pending' || !ps.post_id) {
                if (ps.status === 'pending') allResolved = false;
                continue;
            }

            result.checked++;

            try {
                const postStatus = await blotato.getPostStatus(ps.post_id);

                if (postStatus.status === 'published') {
                    updatedPlatforms[platform] = {
                        status: 'published',
                        post_id: ps.post_id,
                        published_at: postStatus.publishedAt || new Date().toISOString(),
                    };
                    pieceUpdated = true;
                    result.published++;
                } else if (postStatus.status === 'failed') {
                    // Blotato returns the real reason as `errorMessage`; read it
                    // first.
                    //
                    // COUNT the attempt. This is a real failed publish — the
                    // submission was accepted and the post did not go out (the
                    // 2026-06-28 revoked-key shape) — and daily-publish only
                    // increments retry_count when its own submit call THROWS, so
                    // on this path the budget was never spent: `ps.retry_count`
                    // is undefined on a first submission and JSONB drops the key
                    // entirely. hasRetryablePlatform then read 0/5 forever, so
                    // the platform was resubmitted every hour until the 3-day
                    // staleness guard dropped the topic, with no terminal alert.
                    // Each failed attempt is now counted exactly once: here for
                    // accepted-then-failed, in publishTopic for submit errors
                    // (which never produce a post_id for this poll to see).
                    const errorMsg = postStatus.errorMessage || postStatus.error || 'Publishing failed';
                    updatedPlatforms[platform] = {
                        status: 'failed',
                        post_id: ps.post_id,
                        error: errorMsg,
                        retry_count: (ps.retry_count ?? 0) + 1,
                    };
                    pieceUpdated = true;
                    result.failed++;
                } else {
                    allResolved = false;
                    result.stillPending++;
                }
            } catch (e) {
                console.error(`Error checking Blotato status for ${platform} (${ps.post_id}):`, e);
                allResolved = false;
                result.stillPending++;
            }
        }

        if (pieceUpdated) {
            const updateData: Record<string, unknown> = { published_platforms: updatedPlatforms };
            if (allResolved) {
                // Resolved is not the same as published: when the last pending
                // submission comes back FAILED and nothing else on the piece
                // succeeded, this used to stamp status='published' anyway — a
                // piece row claiming success with every platform failed. Same
                // rule as the reconciler below, so the two cannot disagree.
                const anyPublished = Object.values(updatedPlatforms)
                    .some((ps) => classifyPlatformEntry(ps) === 'published');
                updateData.status = anyPublished ? 'published' : 'failed';
                if (anyPublished) updateData.published_at = new Date().toISOString();
            }
            await supabase.from('content_pieces').update(updateData).eq('id', piece.id);
        }
    }

    // ---- Topic settlement pass -------------------------------------------
    //
    // Seed from topics.status, NOT from the piece poll above.
    //
    // 2026-07-21 latch (topic faf48142): the seed set used to be
    // `[...new Set(publishingPieces.map(p => p.topic_id))]`. But the piece flip
    // to status='published' happens in the loop ABOVE, in the SAME invocation.
    // So the tick that resolved a topic's last pending piece also removed that
    // topic from every FUTURE seed set — while the "some piece hasn't fired
    // yet" hold deferred promotion to a next tick that, by construction, could
    // never come. Combined with the (now removed) early return on an empty
    // poll, a frozen topic was unreachable on two independent levels: it sat at
    // status='publishing' with published_at NULL for 5 days, past
    // daily-publish's 22 h selector window, with no code path left that could
    // either fire its last piece or settle it.
    //
    // Seeding from topics.status makes the settlement pass reachable for as
    // long as the topic is unsettled, which is the only correct invariant.
    const pieceTopicIds = [...new Set((publishingPieces ?? []).map(p => p.topic_id))];

    const { data: openTopics } = await supabase
        .from('topics')
        .select('id, status, publish_at, publish_date, published_at, error_message, personas(*)')
        .in('status', ['publishing', 'partially_published']);

    const topicsById = new Map<string, SettleTopicRow>();
    for (const t of (openTopics ?? []) as unknown as SettleTopicRow[]) topicsById.set(t.id, t);

    // Topics that own a piece mid-flight but are not themselves 'publishing'
    // (e.g. daily-publish bounced them back to 'scheduled' on a transient
    // failure). They are pulled in so the per-piece status reconciliation at
    // the end of the loop can still run for them; `isOpen` below keeps the
    // settlement writes off rows the publisher is still actively retrying.
    const uncovered = pieceTopicIds.filter(id => !topicsById.has(id));
    if (uncovered.length > 0) {
        const { data: extraTopics } = await supabase
            .from('topics')
            .select('id, status, publish_at, publish_date, published_at, error_message, personas(*)')
            .in('id', uncovered);
        for (const t of (extraTopics ?? []) as unknown as SettleTopicRow[]) topicsById.set(t.id, t);
    }

    for (const topic of topicsById.values()) {
        const { data: topicPieces } = await supabase
            .from('content_pieces')
            .select('id, status, piece_type, published_platforms, video_url, carousel_url')
            .eq('topic_id', topic.id);

        if (!topicPieces || topicPieces.length === 0) continue;

        const settledAt = now.toISOString();
        const persona = topic.personas;
        const ctx = {
            status: topic.status,
            publish_at: topic.publish_at,
            publish_date: topic.publish_date,
            published_at: topic.published_at,
            accounts: (persona?.platform_accounts ?? null) as PlatformAccounts | null,
            facebook: { enabled: persona?.facebook_enabled, pageIds: persona?.facebook_page_ids },
        };

        // Piece reconciliation is independent of the topic verdict and runs on
        // every tick, whatever happens below: a piece whose platform
        // submissions have all resolved is not 'publishing' any more, whatever
        // the topic is doing. Running it only on the settle path stranded 6
        // live content_pieces at status='publishing' on topics that were
        // already 'published' — rows that re-seeded the piece poll and the
        // `uncovered` backfill on every 10-minute tick, forever.
        await reconcilePieceStatuses(supabase, topicPieces, settledAt);

        // Repair a missing publish anchor BEFORE deciding anything. A
        // 'publishing' topic with publish_at NULL is selected by daily-publish
        // unconditionally and forever, so settlement must hold forever too —
        // the same freeze on a different column, and one that also burns a
        // MAX_TOPICS_PER_TICK slot on every hourly tick. Writing publish_at
        // bounds the publisher and this pass in the SAME write, so the two can
        // never disagree about reach (see publishAtRepair). Deliberately settle
        // on a later tick: the repair ends the publisher's reach right now, and
        // SETTLE_MARGIN_HOURS exists precisely so nothing is condemned until a
        // full publisher tick has passed since reach ended.
        const repairedPublishAt = publishAtRepair(ctx, now);
        if (repairedPublishAt !== null) {
            await supabase
                .from('topics')
                .update({ publish_at: repairedPublishAt })
                .eq('id', topic.id)
                .eq('status', 'publishing');
            result.anchorsRepaired++;
            console.warn(`[check-status] topic ${topic.id} had no publish_at — anchored to ${repairedPublishAt} (publish_date ${topic.publish_date}) so it can leave the publisher's window and settle`);
            continue;
        }

        const settlement = settleTopic(topicPieces as unknown as SettlementPiece[], ctx, now);

        // Only topics that are actually unsettled are this pass's business. A
        // topic in the seed set solely because it owns a mid-flight piece (e.g.
        // daily-publish bounced it back to 'scheduled' on a transient failure)
        // is still the publisher's — settling it here would fight the
        // publisher, and alerting on it would fire every 10 minutes forever,
        // because the marker write below is guarded on the same statuses. Its
        // pieces are reconciled above regardless.
        const isOpen = topic.status === 'publishing' || topic.status === 'partially_published';

        if (settlement.action === 'hold') {
            console.log(`[check-status] topic ${topic.id} held: ${settlement.reason}`);
            // Watchdog. Every hold is legitimate when taken, but a hold that
            // never resolves IS the 2026-07-21 freeze, and that freeze was
            // silent for 5 days. Alert once — the marker is written to
            // error_message, so a re-derived identical hold on the next tick
            // writes nothing and sends nothing.
            const heldSince = holdAnchor(topic);
            if (isOpen
                && heldSince !== null
                && now.getTime() - heldSince >= STUCK_HOLD_ALERT_HOURS * 60 * 60 * 1000) {
                const marker = `Held by check-status: ${settlement.reason}`;
                if ((topic.error_message ?? null) !== marker) {
                    await supabase
                        .from('topics')
                        .update({ error_message: marker })
                        .eq('id', topic.id)
                        .in('status', ['publishing', 'partially_published']);
                    await notifyError({
                        source: 'check-status',
                        message: `Topic stuck for ${Math.floor((now.getTime() - heldSince) / (60 * 60 * 1000))}h without settling: ${settlement.reason}`,
                        topicId: topic.id,
                        personaName: persona?.name ?? undefined,
                    });
                    result.stuckTopics++;
                }
            }
            continue;
        }

        if (isOpen) {
            // Mark pieces that can never fire so they stop blocking settlement,
            // so daily-publish refuses to re-fire them, and so the review UI can
            // name them (it now renders a piece with an empty published_platforms
            // map as "never published" instead of hiding it — an operator
            // staring at faf48142 saw five green pieces and a spinner, with no
            // hint which piece was stuck).
            //
            // The write is a compare-and-set on the precondition the verdict was
            // computed from: the piece had not fired. `.neq('published')` alone
            // was not that — the state meaning "a submission is in flight" is
            // status='publishing' with pending platform entries (publishTopic
            // writes exactly that), and check-status holds no lock against the
            // publisher or against POST /api/topics/[id]/publish. Stamping a
            // live submission 'failed' orphaned its pending entries: the poll at
            // the top of this function only looks at status='publishing', so
            // they would never resolve and every later pass would hold on them
            // forever (2026-07-26 review).
            for (const dead of settlement.unfireable) {
                await supabase
                    .from('content_pieces')
                    .update({ status: 'failed', error_message: `${NEVER_FIRED_PREFIX} ${dead.reason}` })
                    .eq('id', dead.id)
                    .neq('status', 'published')
                    .neq('status', 'publishing');
                result.unfireablePieces++;
            }

            // published_at is load-bearing and must be written EXACTLY ONCE:
            // selectPublishableTopics gates 'partially_published' on
            // `published_at > 7 days ago`, so leaving it NULL drops the topic
            // from daily-publish immediately instead of after 7 days — while
            // re-stamping it every tick means the 7-day drain window never
            // expires and the topic occupies one of MAX_TOPICS_PER_TICK slots
            // forever. Preserve whatever is already there; only fill a NULL.
            //
            // The fill is anchored on the topic's OWN publish instant, never on
            // the settlement clock. Stamping `now` handed a topic that had aged
            // out of the selector a brand-new 7-day drain window — so the very
            // pass that told an operator a piece "could never publish" put the
            // topic back in front of the publisher, which would then publish
            // that piece. Anchoring on publish_at makes the settlement write
            // reach-monotone: it can never extend the window that justified the
            // condemnation (2026-07-26 review).
            const settlementAnchor = topic.published_at ?? topic.publish_at ?? settledAt;
            const neverFiredNote = settlement.neverFired > 0
                ? `, ${settlement.neverFired} piece(s) never fired`
                : '';
            const payload: Record<string, unknown> = settlement.status === 'published'
                // A 'published' topic with a content gap must SAY so: the note
                // is the only durable record (the alert below fires once, and
                // the condemned piece row is hidden in the review UI's platform
                // grid). error_message is cleared when there is no gap, so a
                // topic that finishes draining stops showing a stale failure.
                ? {
                      status: 'published',
                      published_at: settlementAnchor,
                      error_message: settlement.neverFired > 0
                          ? `${settlement.totalPublished} platform posts succeeded${neverFiredNote}`
                          : null,
                  }
                : settlement.status === 'partially_published'
                    ? {
                          status: 'partially_published',
                          published_at: settlementAnchor,
                          error_message: `${settlement.totalPublished} succeeded, ${settlement.totalFailed} failed${neverFiredNote}`,
                      }
                    : settlement.status === 'scheduled'
                        // Hand-back, not a verdict: no published_at (nothing
                        // published), and the row goes back to the status the
                        // publisher retries from.
                        ? {
                              status: 'scheduled',
                              error_message: 'Transient publish failure — handed back to daily-publish for retry',
                          }
                        : { status: 'failed', error_message: `All platform publishes failed${neverFiredNote}` };

            // Idempotence guard. A settled 'partially_published' topic stays in
            // the seed set (daily-publish can still drain its failed platforms),
            // so settleTopic re-derives the same verdict on every 10-minute
            // tick. Without this, each tick rewrote published_at = now, the
            // 7-day drain window never expired, the topic was pinned in the
            // publisher's selector forever, and topics.published_at decayed
            // into "time of last cron tick" — which the review UI, the COO
            // weekly digest and the 90-day dedup window all read.
            const unchanged = topic.status === payload.status
                && (payload.published_at === undefined
                    || (topic.published_at ?? null) === payload.published_at)
                && (payload.error_message === undefined
                    || (topic.error_message ?? null) === payload.error_message);

            if (!unchanged) {
                await supabase
                    .from('topics')
                    .update(payload)
                    .eq('id', topic.id)
                    // Was `.eq('status', 'publishing')` on the failed branch,
                    // which silently no-opped if daily-publish moved the row to
                    // 'partially_published' between our read and this write (no
                    // shared lock between the two crons). All three branches
                    // guard the same way now.
                    .in('status', ['publishing', 'partially_published']);
                result.topicsSettled++;
                if (settlement.status === 'published') result.newlyPublishedTopicIds.push(topic.id);
                if (settlement.status === 'scheduled') result.topicsHandedBack++;
            }

            // A piece that never fired is a real content gap, and the 2026-07-21
            // freeze was silent for 5 days. Alert once per affected topic — only
            // on the pass that condemns it, since `unfireable` is empty on every
            // later tick (the piece is terminally 'failed' by then).
            if (settlement.unfireable.length > 0) {
                await notifyError({
                    source: 'check-status',
                    message: `Topic settled ${settlement.status} with ${settlement.unfireable.length} piece(s) that could never publish: `
                        + settlement.unfireable.map(d => `${d.id} (${d.reason})`).join('; '),
                    topicId: topic.id,
                    personaName: persona?.name ?? undefined,
                });
            }
        }
    }

    return result;
}

/**
 * Move piece rows out of status='publishing' once none of their platform
 * submissions is still in flight.
 *
 * Uses classifyPlatformEntry, so the 2026-07-10 legacy flat-string shape
 * (`{"tiktok": "7515111459437677866"}`) resolves the same way here as it does
 * inside settleTopic. The old inline check asked `ps?.status === 'published'`,
 * which is false for a bare string, so those rows stayed 'publishing' forever
 * on a topic the settlement pass had already called published.
 *
 * A piece whose platforms all failed is likewise not 'publishing' any more —
 * six such rows sat mid-flight in production for three weeks, re-seeding this
 * pass on every tick. It is marked 'failed' WITH its platform entries intact,
 * so daily-publish still retries any platform under budget (the publisher only
 * skips terminally-failed pieces that never fired at all).
 */
async function reconcilePieceStatuses(
    supabase: SupabaseClient,
    pieces: Array<{ id: string; status?: string | null; published_platforms?: unknown }>,
    settledAt: string,
): Promise<void> {
    for (const p of pieces) {
        // Only rows that claim to be mid-flight can change here, and the write
        // is a compare-and-set on that same status. Skipping the rest keeps a
        // tick's cost proportional to the work, not to the number of pieces
        // ever published.
        if (p.status !== 'publishing') continue;
        const entries = Object.values((p.published_platforms ?? {}) as Record<string, unknown>);
        if (entries.length === 0) continue;
        const outcomes = entries.map(classifyPlatformEntry);
        if (outcomes.includes('pending')) continue;

        if (outcomes.includes('published')) {
            await supabase.from('content_pieces')
                .update({ status: 'published', published_at: settledAt })
                .eq('id', p.id)
                .eq('status', 'publishing');
        } else {
            await supabase.from('content_pieces')
                .update({ status: 'failed' })
                .eq('id', p.id)
                .eq('status', 'publishing');
        }
    }
}

/** Milliseconds-since-epoch anchor for "how long has this topic been stuck",
 *  in the same order of preference the reach model uses. Null when the row
 *  carries no usable timestamp at all. */
function holdAnchor(topic: SettleTopicRow): number | null {
    for (const candidate of [
        topic.publish_at,
        publishDayEnd(topic.publish_date)?.toISOString() ?? null,
        topic.published_at,
    ]) {
        if (!candidate) continue;
        const t = new Date(candidate).getTime();
        if (!Number.isNaN(t)) return t;
    }
    return null;
}

/**
 * Auto-generate newsletter drafts for newly published topics.
 * Stores the draft as a content_piece with piece_type context and content_channel = 'newsletter'.
 */
async function generateNewsletterDrafts(
    supabase: SupabaseClient,
    publishedTopicIds: string[],
): Promise<number> {
    let draftsGenerated = 0;

    for (const topicId of publishedTopicIds) {
        // Skip if a newsletter draft already exists for this topic
        const { data: existing } = await supabase
            .from('content_pieces')
            .select('id')
            .eq('topic_id', topicId)
            .eq('content_channel', 'newsletter')
            .limit(1);

        if (existing && existing.length > 0) continue;

        // Fetch topic + persona
        const { data: topicData } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('id', topicId)
            .single();

        if (!topicData) continue;
        const topic = topicData as unknown as TopicWithPersona;
        const persona = topic.personas;

        // Skip if persona has no newsletter CTA configured
        if (!persona.newsletter_cta && !persona.newsletter_url) continue;

        // Fetch the long-form script
        const { data: longPiece } = await supabase
            .from('content_pieces')
            .select('script')
            .eq('topic_id', topicId)
            .eq('piece_type', 'long')
            .single();

        if (!longPiece?.script) continue;

        try {
            const { system, user } = buildNewsletterDraftPrompt(persona, topic, longPiece.script);
            const { text, inputTokens, outputTokens } = await claude.generateContent(
                system,
                user,
                { maxTokens: 4096 },
            );

            const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(jsonText);

            if (parsed.subject && parsed.body) {
                await supabase.from('content_pieces').insert({
                    topic_id: topicId,
                    piece_type: 'long',
                    piece_order: 7,
                    script: parsed.body,
                    caption_long: parsed.subject,
                    caption_short: parsed.previewText || null,
                    content_channel: 'newsletter',
                    status: 'ready',
                });

                const costUsd = estimateClaudeCost(inputTokens, outputTokens);
                await supabase.from('cost_tracking').insert({
                    service: 'claude',
                    operation: 'newsletter_draft',
                    topic_id: topicId,
                    cost_usd: costUsd,
                    tokens_input: inputTokens,
                    tokens_output: outputTokens,
                });

                draftsGenerated++;
            }
        } catch (e) {
            console.error(`Newsletter draft generation failed for topic ${topicId}:`, e);
        }
    }

    return draftsGenerated;
}

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();

        // Clean up expired workflow locks
        const staleLocksRemoved = await cleanStaleLocks();

        const blotatoVideoResult = await pollBlotatoVideoStatuses(supabase);
        const blotatoResult = await pollBlotatoStatuses(supabase);

        // Auto-generate newsletter drafts for newly published topics
        let newsletterDraftsGenerated = 0;
        let cooReportsLogged = 0;
        if (blotatoResult.newlyPublishedTopicIds.length > 0) {
            newsletterDraftsGenerated = await generateNewsletterDrafts(
                supabase,
                blotatoResult.newlyPublishedTopicIds,
            );

            // Log publish report for COO daily standup
            cooReportsLogged = await logPublishReport(
                supabase,
                blotatoResult.newlyPublishedTopicIds,
            );
        }

        const emptyBlotatoVideo = { checked: 0, completed: 0, failed: 0, stillProcessing: 0 };

        if (!blotatoVideoResult && blotatoResult.checked === 0) {
            return NextResponse.json({
                success: true,
                message: 'No pending jobs',
                blotatoVideo: emptyBlotatoVideo,
                blotato: blotatoResult,
                staleLocksRemoved,
                newsletterDraftsGenerated,
                cooReportsLogged,
            });
        }

        return NextResponse.json({
            success: true,
            blotatoVideo: blotatoVideoResult ?? emptyBlotatoVideo,
            blotato: blotatoResult,
            staleLocksRemoved,
            newsletterDraftsGenerated,
            cooReportsLogged,
        });
    } catch (error) {
        console.error('Check-status cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
