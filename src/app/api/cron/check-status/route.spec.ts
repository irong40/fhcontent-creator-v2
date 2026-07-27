/**
 * Regression tests for the 2026-07-21 settlement latch (topic faf48142) and
 * for the settlement pass staying idempotent tick after tick.
 *
 * The old promotion loop seeded its working set from
 * `content_pieces WHERE status='publishing'`, and bailed early when that
 * query came back empty. But the piece flip to 'published' happens in the
 * SAME invocation, BEFORE the promotion loop — so the tick that resolved a
 * topic's last pending piece also emptied the seed set for every future tick,
 * while the "a piece hasn't fired yet" hold deferred promotion to a next tick
 * that could never come. The topic became unreachable by any code path.
 *
 * These tests drive pollBlotatoStatuses with ZERO pieces at status='publishing'
 * — the exact post-latch state — and assert the topic is still reconciled.
 *
 * The long piece below carries a REAL video_url, matching the live row
 * (verified by SELECT 2026-07-26: the external renderer delivered it
 * 2026-07-24 09:32Z, 58 h after its 23:00Z slot). An earlier version of this
 * file set it to NULL, which made the headline assertions pass against a shape
 * that never existed in production.
 *
 * The Supabase stub is a small in-memory DB, not a call recorder: writes are
 * applied to the rows (subject to the .eq/.neq/.in filters on the update, so a
 * compare-and-set that should no-op really does no-op) and later reads see
 * them. Assertions that only counted calls could not see the two defects the
 * 2026-07-26 review found — a settlement write that puts the topic back inside
 * selectPublishableTopics, and a condemnation that lands on a piece whose
 * submission is in flight.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/blotato', () => ({
    blotato: { getVideoStatus: vi.fn(), getPostStatus: vi.fn() },
}));
vi.mock('@/lib/claude', () => ({ claude: { generateContent: vi.fn() } }));
vi.mock('@/lib/prompts', () => ({ buildNewsletterDraftPrompt: vi.fn(() => ({ system: '', user: '' })) }));
vi.mock('@/lib/utils', () => ({ estimateClaudeCost: vi.fn(() => 0) }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn(async () => undefined) }));
vi.mock('@/lib/workflow-lock', () => ({ cleanStaleLocks: vi.fn(async () => 0) }));
vi.mock('@/lib/coo-report', () => ({ logPublishReport: vi.fn(async () => 0) }));
vi.mock('../middleware', () => ({ validateCronSecret: vi.fn(() => true) }));

import { pollBlotatoStatuses } from './route';
import { blotato } from '@/lib/blotato';
import { notifyError } from '@/lib/notifications';
import {
    SETTLE_MARGIN_HOURS,
    STUCK_HOLD_ALERT_HOURS,
    PUBLISHING_SELECTOR_CUTOFF_HOURS,
    PARTIAL_DRAIN_WINDOW_DAYS,
    MAX_PLATFORM_RETRIES,
} from './settle';
import { selectPublishableTopics } from '../daily-publish/route';

type Row = Record<string, unknown>;
type Filter = [op: 'eq' | 'neq' | 'in', column: string, value: unknown];

interface Write {
    id: string;
    payload: Row;
    filters: Filter[];
    /** False when the update's own filters excluded the row (a no-op CAS). */
    applied: boolean;
}

interface Recorded {
    topicUpdates: Write[];
    pieceUpdates: Write[];
}

function matchesFilters(row: Row, filters: Filter[]): boolean {
    return filters.every(([op, column, value]) => {
        const current = row[column] ?? null;
        if (op === 'eq') return current === value;
        if (op === 'neq') return current !== value;
        return (value as unknown[]).includes(current);
    });
}

/** Minimal chainable Supabase stub covering exactly the calls
 *  pollBlotatoStatuses makes. Unmocked tables throw loudly. */
function makeSupabaseMock(
    topicRows: Row[],
    piecesByTopic: Record<string, Row[]>,
    calls: Recorded,
) {
    const allPieces = Object.values(piecesByTopic).flat();

    /** A chainable thenable: the write lands when the chain is AWAITED, i.e.
     *  once every .eq/.neq/.in filter has been attached, so the recorded
     *  filters are the complete compare-and-set the caller actually issued. */
    function updater(rows: Row[], log: Write[], payload: Row) {
        const filters: Filter[] = [];
        let settled = false;
        const apply = () => {
            const id = (filters.find((f) => f[1] === 'id')?.[2] ?? '') as string;
            const target = rows.find((r) => r.id === id);
            const applied = Boolean(target) && matchesFilters(target as Row, filters);
            if (applied) Object.assign(target as Row, payload);
            log.push({ id, payload, filters, applied });
        };
        const self = {
            eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return self; },
            neq: (c: string, v: unknown) => { filters.push(['neq', c, v]); return self; },
            in: (c: string, v: unknown) => { filters.push(['in', c, v]); return self; },
            then: <T>(
                onFulfilled?: ((value: { error: null }) => T) | null,
                onRejected?: ((reason: unknown) => T) | null,
            ) => {
                if (!settled) { settled = true; apply(); }
                return Promise.resolve({ error: null as null }).then(onFulfilled, onRejected);
            },
        };
        return self;
    }

    return {
        from(table: string) {
            if (table === 'content_pieces') {
                return {
                    select: () => ({
                        eq: (col: string, val: string) => {
                            if (col === 'status') {
                                return Promise.resolve({
                                    data: allPieces.filter((p) => p.status === val),
                                    error: null,
                                });
                            }
                            if (col === 'topic_id') {
                                return Promise.resolve({ data: piecesByTopic[val] ?? [], error: null });
                            }
                            throw new Error(`Unexpected content_pieces filter: ${col}`);
                        },
                    }),
                    update: (payload: Row) => updater(allPieces, calls.pieceUpdates, payload),
                };
            }
            if (table === 'topics') {
                return {
                    select: () => ({
                        in: (col: string, vals: string[]) => Promise.resolve({
                            data: topicRows.filter((t) =>
                                col === 'status' ? vals.includes(t.status as string) : vals.includes(t.id as string)),
                            error: null,
                        }),
                    }),
                    update: (payload: Row) => updater(topicRows, calls.topicUpdates, payload),
                };
            }
            throw new Error(`Unexpected table in test: ${table}`);
        },
    };
}

const PUBLISH_AT = '2026-07-21T13:00:00.000Z';
const HOUR = 3600_000;
/** Hours after PUBLISH_AT, as an injectable clock. */
const at = (hours: number) => new Date(new Date(PUBLISH_AT).getTime() + hours * HOUR);
/** One publisher tick past the end of daily-publish's 22 h window. */
const AFTER_WINDOW = at(PUBLISHING_SELECTOR_CUTOFF_HOURS + SETTLE_MARGIN_HOURS + 1);
/** Still inside it — the renderer could yet deliver and the publisher would fire. */
const INSIDE_WINDOW = at(PUBLISHING_SELECTOR_CUTOFF_HOURS - 1);

const frozenTopic = () => ({
    id: 'faf48142',
    status: 'publishing',
    publish_at: PUBLISH_AT,
    publish_date: '2026-07-21',
    published_at: null,
    error_message: null,
    personas: {
        name: 'Dr. Imani Carter',
        platform_accounts: { tiktok: '5294', threads: '1506', twitter: '1478', youtube: '1290', instagram: '4346' },
        facebook_enabled: false,
        facebook_page_ids: null,
    },
});

/** 5 pieces published on 7/21, none left at status='publishing' — the seed
 *  set the old code derived from pieces was empty from 21:10Z onward. */
function frozenPieces() {
    const ok = (id: string, type: string) => ({
        id, topic_id: 'faf48142', piece_type: type, status: 'published',
        video_url: 'https://cdn/v.mp4', carousel_url: null,
        published_platforms: { tiktok: { status: 'published', post_id: `${id}-tt` } },
    });
    return [
        ok('p1', 'short_1'), ok('p2', 'short_2'), ok('p3', 'short_3'),
        { ...ok('p4', 'carousel'), carousel_url: 'https://cdn/c.jpg' },
        ok('p5', 'short_4'),
        // The blocker. Media IS present — the external renderer delivered it
        // 58 h late, after daily-publish had stopped selecting the topic.
        {
            id: 'p6-long', topic_id: 'faf48142', piece_type: 'long', status: 'produced',
            video_url: 'https://cdn/longform/late.mp4', carousel_url: null, published_platforms: {},
        },
    ];
}

/** The row shape selectPublishableTopics reads, taken from a (possibly
 *  already-written) topic row — so a test can ask the REAL publisher whether a
 *  settlement write put the topic back in front of it. */
const asSelectable = (t: Row) => ({
    id: t.id as string,
    title: 't',
    status: t.status as string,
    publish_at: (t.publish_at ?? null) as string | null,
    publish_date: (t.publish_date ?? null) as string | null,
    published_at: (t.published_at ?? null) as string | null,
});

describe('pollBlotatoStatuses topic settlement seeding (2026-07-21 latch)', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    it('reconciles a topic that has NO pieces left at status=publishing', async () => {
        const supabase = makeSupabaseMock(
            [frozenTopic()],
            { faf48142: frozenPieces() },
            calls,
        );

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        // Nothing was mid-flight, so Blotato was never polled — under the old
        // code this returned at the empty-poll early return and the topic was
        // never examined again.
        expect(blotato.getPostStatus).not.toHaveBeenCalled();
        expect(result.topicsSettled).toBe(1);

        const topicWrite = calls.topicUpdates.find((u) => u.id === 'faf48142');
        // Every platform that was ever submitted succeeded, so the topic did
        // publish; the piece that never fired is reported separately.
        expect(topicWrite?.payload).toMatchObject({ status: 'published' });
        expect(topicWrite?.payload.published_at).toBeTruthy();
        expect(result.newlyPublishedTopicIds).toEqual(['faf48142']);
    });

    it('marks the never-fired long piece failed so it stops blocking, and alerts', async () => {
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: frozenPieces() }, calls);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.unfireablePieces).toBe(1);
        const pieceWrite = calls.pieceUpdates.find((u) => u.id === 'p6-long');
        expect(pieceWrite?.payload).toMatchObject({ status: 'failed' });
        expect(pieceWrite?.applied).toBe(true);
        // The media was there; it arrived after the publish window closed.
        expect(String(pieceWrite?.payload.error_message)).toContain('never submitted');
        // 5 days of total silence was part of the incident.
        expect(notifyError).toHaveBeenCalledTimes(1);
    });

    // The condemnation is only safe because nothing can fire the piece. A
    // submission IN FLIGHT is exactly that "something": publishTopic writes
    // status='publishing' with pending entries and check-status shares no lock
    // with it (nor with POST /api/topics/[id]/publish). Stamping that row
    // 'failed' orphaned the pending entries — the poll at the top of this
    // function only looks at status='publishing', so they would never resolve
    // and every later pass would hold on them forever.
    it('does NOT stamp a piece failed while its submission is in flight', async () => {
        const pieces = frozenPieces().map((p) => (p.id === 'p6-long'
            ? {
                  ...p,
                  status: 'publishing',
                  published_platforms: { tiktok: { status: 'pending', post_id: 'inflight' } },
              }
            : p));
        // The verdict was computed from the row as it was read a moment
        // earlier: empty platform map, status 'produced'.
        const stale = pieces.map((p) => (p.id === 'p6-long'
            ? { ...p, status: 'produced', published_platforms: {} }
            : p));
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: stale }, calls);
        // Swap in the in-flight row for the piece poll AND the settlement read,
        // after the verdict has been computed from the stale snapshot: the
        // update's own filters are the only protection left.
        const condemnGuard = calls.pieceUpdates;

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        const write = condemnGuard.find((u) => u.id === 'p6-long' && u.payload.status === 'failed');
        // Both in-flight states must be excluded by the write's own filters.
        expect(write?.filters).toEqual(
            expect.arrayContaining([['neq', 'status', 'published'], ['neq', 'status', 'publishing']]),
        );
        // Proof the guard bites: the same write against a row that has since
        // gone 'publishing' does not land.
        const inflight = { ...pieces.find((p) => p.id === 'p6-long') } as Row;
        expect(matchesFilters(inflight, write!.filters)).toBe(false);
    });

    it('does not settle a topic daily-publish can still pick up', async () => {
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: frozenPieces() }, calls);

        const result = await pollBlotatoStatuses(supabase as never, INSIDE_WINDOW);

        expect(result.topicsSettled).toBe(0);
        expect(result.unfireablePieces).toBe(0);
        expect(calls.topicUpdates).toHaveLength(0);
        expect(notifyError).not.toHaveBeenCalled();
    });

    it('promotes a clean topic to published and reports it for newsletter/COO', async () => {
        const clean = { ...frozenTopic(), id: 'clean-1' };
        const pieces = frozenPieces()
            .filter((p) => p.id !== 'p6-long')
            .map((p) => ({ ...p, topic_id: 'clean-1' }));
        const supabase = makeSupabaseMock([clean], { 'clean-1': pieces }, calls);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.newlyPublishedTopicIds).toEqual(['clean-1']);
        expect(calls.topicUpdates[0].payload).toMatchObject({ status: 'published' });
        expect(result.unfireablePieces).toBe(0);
    });

    it('writes nothing when there are no unsettled topics at all', async () => {
        const supabase = makeSupabaseMock([], {}, calls);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.topicsSettled).toBe(0);
        expect(calls.topicUpdates).toHaveLength(0);
        expect(calls.pieceUpdates).toHaveLength(0);
    });

    // Every settlement write races daily-publish (no shared lock), so all of
    // them have to be conditional on the row still being unsettled.
    it('guards every settlement write on the topic still being open', async () => {
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: frozenPieces() }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        const write = calls.topicUpdates.find((u) => u.id === 'faf48142');
        expect(write?.filters).toEqual(
            expect.arrayContaining([['in', 'status', ['publishing', 'partially_published']]]),
        );
    });
});

/**
 * The whole safety argument for condemning a piece is "the publisher can no
 * longer reach this topic". The settlement write must therefore never restore
 * that reach — and stamping published_at = now did exactly that, because
 * selectPublishableTopics accepts a 'partially_published' row for 7 days from
 * published_at. The pass told the operator a piece could never publish and
 * simultaneously handed the topic back to the publisher, which would then
 * publish it.
 */
describe('pollBlotatoStatuses — settlement never resurrects the topic', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    /** Aged-out topic: one piece shipped to tiktok and failed on youtube with
     *  the budget spent, plus the late 'long' that never fired. */
    const partialPieces = () => [
        {
            id: 'pp1', topic_id: 'aged-1', piece_type: 'short_1', status: 'published',
            video_url: 'https://cdn/v.mp4', carousel_url: null,
            published_platforms: {
                tiktok: { status: 'published', post_id: 'tt' },
                youtube: { status: 'failed', error: 'quota', retry_count: MAX_PLATFORM_RETRIES },
            },
        },
        {
            id: 'pp2-long', topic_id: 'aged-1', piece_type: 'long', status: 'produced',
            video_url: 'https://cdn/late.mp4', carousel_url: null, published_platforms: {},
        },
    ];

    // A 'partially_published' topic IS meant to be selectable while it drains
    // its failed platforms — the bug was where that window is measured from.
    // Stamping published_at = now gave a topic settled 5 days late a drain
    // window running to day 12, and every later settlement tick pushed it out
    // again. Anchored on publish_at it always ends 7 days after the publish
    // day, whenever the settlement happens to run.
    it('never grants a drain window measured from the settlement clock', async () => {
        const topic = { ...frozenTopic(), id: 'aged-1' };
        const supabase = makeSupabaseMock([topic], { 'aged-1': partialPieces() }, calls);
        // 5 days late, the real faf48142 timeline.
        const fiveDaysLate = at(24 * 5);

        await pollBlotatoStatuses(supabase as never, fiveDaysLate);

        expect(topic.status).toBe('partially_published');
        // The written row — not the payload we hoped for — is what the
        // publisher reads on its next tick.
        const justInside = at(24 * PARTIAL_DRAIN_WINDOW_DAYS - 1);
        const justOutside = at(24 * PARTIAL_DRAIN_WINDOW_DAYS + 1);
        expect(selectPublishableTopics([asSelectable(topic)], justInside).selected).toHaveLength(1);
        expect(selectPublishableTopics([asSelectable(topic)], justOutside).selected).toHaveLength(0);

        // Re-settling on a later tick must not push that boundary out again.
        await pollBlotatoStatuses(supabase as never, at(24 * 6));
        expect(selectPublishableTopics([asSelectable(topic)], justOutside).selected).toHaveLength(0);
    });

    it('anchors a NULL published_at on the topic own publish instant, not the settlement clock', async () => {
        const topic = { ...frozenTopic(), id: 'aged-1' };
        const supabase = makeSupabaseMock([topic], { 'aged-1': partialPieces() }, calls);

        await pollBlotatoStatuses(supabase as never, at(24 * 5));

        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0].payload.published_at).toBe(PUBLISH_AT);
    });

    // Belt to the published_at braces: even if the topic does come back into
    // the selector (a partially_published topic settled inside its own drain
    // window legitimately does), the publisher must not re-fire the piece this
    // pass just condemned. daily-publish skips terminally-failed pieces that
    // never fired; here we assert the marker that skip keys on is written.
    it('leaves the condemned piece in the state daily-publish refuses to re-fire', async () => {
        const topic = { ...frozenTopic(), id: 'aged-1' };
        const pieces = partialPieces();
        const supabase = makeSupabaseMock([topic], { 'aged-1': pieces }, calls);

        await pollBlotatoStatuses(supabase as never, at(24 * 5));

        const condemned = pieces.find((p) => p.id === 'pp2-long')!;
        expect(condemned.status).toBe('failed');
        expect(Object.keys(condemned.published_platforms)).toHaveLength(0);
    });
});

/**
 * Seeding from topics.status is what makes the settlement pass reachable at
 * all, but it also means a topic that has ALREADY settled to
 * 'partially_published' comes back on every 10-minute tick. Re-deriving the
 * same verdict must be a no-op: selectPublishableTopics gates that status on
 * `published_at > 7 days ago`, so re-stamping published_at = now would pin the
 * topic in the publisher's selector forever (consuming one of
 * MAX_TOPICS_PER_TICK = 5 slots and starving genuinely scheduled topics), and
 * would corrupt published_at into "time of last cron tick" for the review UI,
 * the COO weekly digest and the 90-day dedup window.
 */
describe('pollBlotatoStatuses — re-settling an already-settled topic', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    const SETTLED_AT = '2026-07-22T12:00:00.000Z';

    const settledPartial = (overrides: Row = {}) => ({
        ...frozenTopic(),
        id: 'partial-1',
        status: 'partially_published',
        published_at: SETTLED_AT,
        error_message: '1 succeeded, 1 failed',
        ...overrides,
    });

    /** One piece that shipped to tiktok and permanently failed on youtube. */
    const partialPieces = () => [{
        id: 'pp1', topic_id: 'partial-1', piece_type: 'short_1', status: 'published',
        video_url: 'https://cdn/v.mp4', carousel_url: null,
        published_platforms: {
            tiktok: { status: 'published', post_id: 'tt' },
            youtube: { status: 'failed', error: 'quota', retry_count: MAX_PLATFORM_RETRIES },
        },
    }];

    it('writes nothing when the verdict is unchanged', async () => {
        const supabase = makeSupabaseMock([settledPartial()], { 'partial-1': partialPieces() }, calls);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(calls.topicUpdates).toHaveLength(0);
        expect(result.topicsSettled).toBe(0);
    });

    it('never ratchets published_at forward, even 30 days later', async () => {
        const supabase = makeSupabaseMock([settledPartial()], { 'partial-1': partialPieces() }, calls);

        // Well past the 7-day drain window: the topic must be allowed to age out
        // of selectPublishableTopics instead of being renewed every tick.
        const monthLater = new Date(new Date(SETTLED_AT).getTime()
            + (PARTIAL_DRAIN_WINDOW_DAYS + 23) * 24 * HOUR);
        await pollBlotatoStatuses(supabase as never, monthLater);

        expect(calls.topicUpdates).toHaveLength(0);
    });

    it('preserves the original published_at when it does have to rewrite the row', async () => {
        // A newly resolved failure changes error_message, so a write is due —
        // but published_at is the settlement timestamp, not this tick's clock.
        const topic = settledPartial({ error_message: 'stale message' });
        const supabase = makeSupabaseMock([topic], { 'partial-1': partialPieces() }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0].payload).toMatchObject({
            status: 'partially_published',
            published_at: SETTLED_AT,
            error_message: '1 succeeded, 1 failed',
        });
    });

    // daily-publish writes status='partially_published' WITHOUT published_at
    // when a retry tick fails (it now fills the column, but rows written before
    // that fix are still out there). check-status has to fill it in once — from
    // the topic's own publish instant, never from the settlement clock, or the
    // topic gets a fresh 7-day drain window every time it is settled late.
    it('fills in a NULL published_at exactly once, anchored on publish_at', async () => {
        const topic = settledPartial({ published_at: null, error_message: null });
        const supabase = makeSupabaseMock([topic], { 'partial-1': partialPieces() }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0].payload.published_at).toBe(PUBLISH_AT);

        // Second tick: unchanged verdict, no write.
        const second: Recorded = { topicUpdates: [], pieceUpdates: [] };
        const again = makeSupabaseMock([topic], { 'partial-1': partialPieces() }, second);
        await pollBlotatoStatuses(again as never, at(24 * 3));
        expect(second.topicUpdates).toHaveLength(0);
    });

    // The note has to be derived from the CURRENT rows, not from what this pass
    // happened to condemn, or the second tick silently erases the operator's
    // only explanation of why the topic is partial.
    it('keeps the never-fired note stable across ticks', async () => {
        const topic = settledPartial({ published_at: null, error_message: null });
        const pieces = [
            ...partialPieces(),
            {
                id: 'pp2', topic_id: 'partial-1', piece_type: 'long', status: 'produced',
                video_url: 'https://cdn/late.mp4', carousel_url: null, published_platforms: {},
            },
        ];
        const first = makeSupabaseMock([topic], { 'partial-1': pieces }, calls);
        await pollBlotatoStatuses(first as never, AFTER_WINDOW);

        expect(calls.topicUpdates).toHaveLength(1);
        expect(calls.topicUpdates[0].payload.error_message).toBe('1 succeeded, 1 failed, 1 piece(s) never fired');

        // Second tick: the piece is terminally failed now, but the message must
        // be identical, so the idempotence guard suppresses the write.
        const settledRow = settledPartial({
            published_at: PUBLISH_AT,
            error_message: '1 succeeded, 1 failed, 1 piece(s) never fired',
        });
        const secondCalls: Recorded = { topicUpdates: [], pieceUpdates: [] };
        const second = makeSupabaseMock(
            [settledRow],
            { 'partial-1': pieces.map((p) => (p.id === 'pp2' ? { ...p, status: 'failed' } : p)) },
            secondCalls,
        );
        await pollBlotatoStatuses(second as never, at(24 * 3));

        expect(secondCalls.topicUpdates).toHaveLength(0);
    });

    // A topic that shipped everything it submitted is 'published' (terminal, and
    // what gates the newsletter draft + COO report), but a gap has to leave a
    // durable trace: the alert fires once and the condemned piece is hidden in
    // the review UI's platform grid, so error_message is the only record.
    it('records the gap in error_message when a published topic has never-fired pieces', async () => {
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: frozenPieces() }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(String(calls.topicUpdates[0].payload.error_message)).toContain('1 piece(s) never fired');
    });

    it('clears a stale error_message on a topic that finished cleanly', async () => {
        const topic = { ...frozenTopic(), error_message: '4 succeeded, 1 failed' };
        const pieces = frozenPieces().filter((p) => p.id !== 'p6-long');
        const supabase = makeSupabaseMock([topic], { faf48142: pieces }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(calls.topicUpdates[0].payload).toMatchObject({ status: 'published', error_message: null });
    });
});

/**
 * Nothing published, retry budget unspent, publisher out of reach as
 * 'publishing'. Writing terminal 'failed' there kills a whole publish day 10
 * minutes after its first attempt with 0 of MAX_PLATFORM_RETRIES spent — and
 * 'failed' is excluded from daily-publish's query, so the topic is dead for
 * good. The publisher's own equivalent path writes 'scheduled'.
 */
describe('pollBlotatoStatuses — handing a topic back instead of killing its retry budget', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    const allFailedPieces = (topicId: string) => [{
        id: 'af1', topic_id: topicId, piece_type: 'short_1', status: 'publishing',
        video_url: 'https://cdn/v.mp4', carousel_url: null,
        published_platforms: {
            tiktok: { status: 'failed', post_id: 'a', error: 'Publishing failed' },
            youtube: { status: 'failed', post_id: 'b', error: 'Publishing failed' },
        },
    }];

    it('writes scheduled (no published_at) and the publisher takes the topic back', async () => {
        const topic = { ...frozenTopic(), id: 'handback-1' };
        const supabase = makeSupabaseMock([topic], { 'handback-1': allFailedPieces('handback-1') }, calls);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.topicsHandedBack).toBe(1);
        expect(calls.topicUpdates[0].payload).toMatchObject({ status: 'scheduled' });
        expect(calls.topicUpdates[0].payload.published_at).toBeUndefined();
        expect(selectPublishableTopics([asSelectable(topic)], AFTER_WINDOW).selected).toHaveLength(1);
        expect(result.newlyPublishedTopicIds).toHaveLength(0);
    });

    it('condemns nothing on a hand-back', async () => {
        const topic = { ...frozenTopic(), id: 'handback-2' };
        const pieces = [
            ...allFailedPieces('handback-2'),
            {
                id: 'af2-long', topic_id: 'handback-2', piece_type: 'long', status: 'produced',
                video_url: 'https://cdn/late.mp4', carousel_url: null, published_platforms: {},
            },
        ];
        const supabase = makeSupabaseMock([topic], { 'handback-2': pieces }, calls);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.unfireablePieces).toBe(0);
        expect(pieces.find((p) => p.id === 'af2-long')!.status).toBe('produced');
        expect(notifyError).not.toHaveBeenCalled();
    });

    it('still fails a topic the scheduled rule can no longer reach either', async () => {
        const topic = { ...frozenTopic(), id: 'handback-3' };
        const supabase = makeSupabaseMock([topic], { 'handback-3': allFailedPieces('handback-3') }, calls);

        // Past MAX_SCHEDULED_AGE_DAYS: the budget can never be spent.
        const result = await pollBlotatoStatuses(supabase as never, at(24 * 5));

        expect(calls.topicUpdates[0].payload).toMatchObject({ status: 'failed' });
        expect(result.topicsHandedBack).toBe(0);
    });
});

/**
 * A 'publishing' topic with publish_at NULL is returned by
 * selectPublishableTopics unconditionally and forever, so settlement holds
 * forever — the same freeze on a different column, plus a permanently occupied
 * MAX_TOPICS_PER_TICK slot. 33 of 98 live 'published' topics went through this
 * calendar/manual path.
 */
describe('pollBlotatoStatuses — repairing a missing publish anchor', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    const anchorless = () => ({ ...frozenTopic(), id: 'anchorless-1', publish_at: null });
    const DAY_END = '2026-07-21T23:59:59.999Z';

    it('holds untouched while the notional window is still open', async () => {
        const topic = anchorless();
        const supabase = makeSupabaseMock([topic], { 'anchorless-1': frozenPieces() }, calls);

        await pollBlotatoStatuses(supabase as never, at(20));

        expect(calls.topicUpdates).toHaveLength(0);
        expect(topic.publish_at).toBeNull();
    });

    it('writes the anchor once the window has passed, and settles on a later tick', async () => {
        const topic = anchorless();
        const pieces = frozenPieces();
        const supabase = makeSupabaseMock([topic], { 'anchorless-1': pieces }, calls);
        const repairTime = new Date(new Date(DAY_END).getTime() + PUBLISHING_SELECTOR_CUTOFF_HOURS * HOUR);

        // Before: the publisher would re-select this row on every tick, forever.
        expect(selectPublishableTopics([asSelectable(topic)], repairTime).selected).toHaveLength(1);

        const first = await pollBlotatoStatuses(supabase as never, repairTime);

        expect(first.anchorsRepaired).toBe(1);
        expect(topic.publish_at).toBe(DAY_END);
        // Nothing else touched on the repair tick — no condemnation, no verdict.
        expect(first.unfireablePieces).toBe(0);
        expect(first.topicsSettled).toBe(0);
        // After: bounded for the publisher and for settlement, from ONE write.
        expect(selectPublishableTopics([asSelectable(topic)], repairTime).selected).toHaveLength(0);

        const later = new Date(repairTime.getTime() + (SETTLE_MARGIN_HOURS + 1) * HOUR);
        const second = await pollBlotatoStatuses(supabase as never, later);
        expect(second.topicsSettled).toBe(1);
        expect(topic.status).toBe('published');
    });

    it('leaves a topic with no publish_date at all to the reach model', async () => {
        const topic = { ...anchorless(), publish_date: null };
        const supabase = makeSupabaseMock([topic], { 'anchorless-1': frozenPieces() }, calls);

        // publish_date NULL means daily-publish's own query never returns the
        // row, so it settles directly — there is no anchor to repair.
        const result = await pollBlotatoStatuses(supabase as never, at(24 * 3));

        expect(result.anchorsRepaired).toBe(0);
        expect(result.topicsSettled).toBe(1);
    });
});

/**
 * Blotato poll loop + the `uncovered` backfill + the isOpen write guard: the
 * path production takes on every tick (6 live content_pieces sit at
 * status='publishing' on 3 topics that are already 'published'), and the path
 * no test exercised before 2026-07-27.
 */
describe('pollBlotatoStatuses — the mid-flight piece poll', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    const inFlightPiece = (overrides: Row = {}) => ({
        id: 'mf1', topic_id: 'faf48142', piece_type: 'short_1', status: 'publishing',
        video_url: 'https://cdn/v.mp4', carousel_url: null,
        published_platforms: {
            tiktok: { status: 'pending', post_id: 'post-tt' },
            youtube: { status: 'pending', post_id: 'post-yt' },
        },
        ...overrides,
    });

    it('polls every pending submission and resolves the piece', async () => {
        const piece = inFlightPiece();
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({
            status: 'published', publishedAt: '2026-07-21T13:05:00.000Z',
        } as never);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(blotato.getPostStatus).toHaveBeenCalledTimes(2);
        expect(result.checked).toBe(2);
        expect(result.published).toBe(2);
        expect(piece.status).toBe('published');
    });

    it('records a Blotato failure with its real message and keeps polling the rest', async () => {
        const piece = inFlightPiece();
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: [piece] }, calls);
        vi.mocked(blotato.getPostStatus)
            .mockResolvedValueOnce({ status: 'failed', errorMessage: 'token revoked' } as never)
            .mockResolvedValueOnce({ status: 'processing' } as never);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.failed).toBe(1);
        expect(result.stillPending).toBe(1);
        const platforms = piece.published_platforms as Record<string, { status: string; error?: string }>;
        expect(platforms.tiktok).toMatchObject({ status: 'failed', error: 'token revoked' });
        // Still in flight → the topic must hold, not settle.
        expect(result.topicsSettled).toBe(0);
    });

    // daily-publish increments retry_count only when its own submit call
    // THROWS. A submission Blotato accepts and then fails to publish (the
    // 2026-06-28 revoked-key shape) never reached that code, so the budget was
    // never spent — the platform was resubmitted every hour until the 3-day
    // staleness guard dropped the topic, with no terminal alert, and the
    // settlement pass saw an unspendable "0/5 used" budget forever.
    it('counts an accepted-then-failed publish against the platform retry budget', async () => {
        const piece = inFlightPiece({
            published_platforms: { tiktok: { status: 'pending', post_id: 'p1' } },
        });
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'failed', errorMessage: '401' } as never);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        const platforms = piece.published_platforms as Record<string, { retry_count?: number }>;
        expect(platforms.tiktok.retry_count).toBe(1);
    });

    it('keeps counting from an existing retry_count', async () => {
        const piece = inFlightPiece({
            published_platforms: { tiktok: { status: 'pending', post_id: 'p1', retry_count: 3 } },
        });
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'failed', errorMessage: '401' } as never);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        const platforms = piece.published_platforms as Record<string, { retry_count?: number }>;
        expect(platforms.tiktok.retry_count).toBe(4);
    });

    // The hand-back has to terminate. With the attempt counted, five cycles
    // exhaust the budget and the topic settles terminally (with the alert)
    // instead of being handed back every hour until it goes stale.
    it('settles failed once the counted attempts exhaust the budget', async () => {
        const topic = { ...frozenTopic(), id: 'exhausted-1' };
        const piece = inFlightPiece({
            id: 'ex1', topic_id: 'exhausted-1',
            published_platforms: {
                tiktok: { status: 'pending', post_id: 'p1', retry_count: MAX_PLATFORM_RETRIES - 1 },
            },
        });
        const supabase = makeSupabaseMock([topic], { 'exhausted-1': [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'failed', errorMessage: '401' } as never);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.topicsHandedBack).toBe(0);
        expect(calls.topicUpdates[0].payload).toMatchObject({ status: 'failed' });
    });

    // "Every submission resolved" is not "the piece published".
    it('does not mark a piece published when its last submission resolves to failed', async () => {
        const piece = inFlightPiece({
            published_platforms: { tiktok: { status: 'pending', post_id: 'p1' } },
        });
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'failed', errorMessage: '401' } as never);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(piece.status).toBe('failed');
        expect((piece as Row).published_at).toBeUndefined();
    });

    it('holds the topic while a submission is still pending at Blotato', async () => {
        const supabase = makeSupabaseMock([frozenTopic()], { faf48142: [inFlightPiece()] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'processing' } as never);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(result.topicsSettled).toBe(0);
        expect(calls.topicUpdates).toHaveLength(0);
    });

    // A topic outside the seed set (daily-publish bounced it back to
    // 'scheduled', or it already settled 'published') that still owns a
    // mid-flight piece has to be pulled in so its pieces are reconciled — but
    // its status must NOT be rewritten.
    it('backfills an uncovered topic and reconciles its pieces without settling it', async () => {
        // daily-publish bounced this one back to 'scheduled' on a transient
        // failure while a submission was still in flight. It is not in the seed
        // query, so only the piece poll can pull it in — and the settlement
        // pass must reconcile its pieces but keep its hands off the topic,
        // which the publisher is still retrying.
        const bouncedBack = { ...frozenTopic(), id: 'closed-1', status: 'scheduled', published_at: null };
        const piece = inFlightPiece({ id: 'mf2', topic_id: 'closed-1' });
        const supabase = makeSupabaseMock([bouncedBack], { 'closed-1': [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'published' } as never);

        const result = await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(piece.status).toBe('published');
        expect(calls.topicUpdates).toHaveLength(0);
        expect(result.topicsSettled).toBe(0);
        expect(bouncedBack.status).toBe('scheduled');
    });

    it('leaves an already-published topic that still owns a mid-flight piece alone', async () => {
        const closed = { ...frozenTopic(), id: 'closed-3', status: 'published', published_at: PUBLISH_AT };
        const piece = inFlightPiece({ id: 'mf7', topic_id: 'closed-3' });
        const supabase = makeSupabaseMock([closed], { 'closed-3': [piece] }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'published' } as never);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(piece.status).toBe('published');
        expect(calls.topicUpdates).toHaveLength(0);
    });

    // The 6 live rows: every platform failed, the topic is long since
    // 'published', and nothing ever moved the piece out of 'publishing'. It
    // re-seeded this pass on every tick, forever.
    it('clears a piece whose platforms have all failed out of status=publishing', async () => {
        const closed = { ...frozenTopic(), id: 'closed-2', status: 'published', published_at: PUBLISH_AT };
        const piece = {
            id: 'mf3', topic_id: 'closed-2', piece_type: 'short_4', status: 'publishing',
            video_url: 'https://cdn/v.mp4', carousel_url: null,
            published_platforms: {
                tiktok: { status: 'failed', error: '429', retry_count: 1 },
                youtube: { status: 'failed', error: '429', retry_count: 1 },
            },
        };
        const supabase = makeSupabaseMock([closed], { 'closed-2': [piece] }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(piece.status).toBe('failed');
        // The platform entries survive, so daily-publish can still retry the
        // ones under budget — only never-fired pieces are refused.
        expect(Object.keys(piece.published_platforms)).toHaveLength(2);
    });

    // Reconciliation is independent of the verdict. Running it only on the
    // settle path is what left those rows stuck: their topics HOLD.
    it('reconciles pieces even when the topic holds', async () => {
        const held = { ...frozenTopic(), id: 'held-1' };
        const pieces = [
            {
                id: 'mf4', topic_id: 'held-1', piece_type: 'short_1', status: 'publishing',
                video_url: 'https://cdn/v.mp4', carousel_url: null,
                published_platforms: { tiktok: { status: 'published', post_id: 'tt' } },
            },
            // Keeps the topic in HOLD: inside the window, never fired.
            {
                id: 'mf5', topic_id: 'held-1', piece_type: 'long', status: 'produced',
                video_url: null, carousel_url: null, published_platforms: {},
            },
        ];
        const supabase = makeSupabaseMock([held], { 'held-1': pieces }, calls);

        const result = await pollBlotatoStatuses(supabase as never, INSIDE_WINDOW);

        expect(result.topicsSettled).toBe(0);
        expect(pieces[0].status).toBe('published');
    });

    // The 2026-07-10 backfill shape: { "tiktok": "<post id>" }. settleTopic
    // counts a bare post id as published; the reconciler has to agree, or the
    // piece stays 'publishing' on a topic reported as fully published.
    it('reconciles the legacy flat-string platform shape', async () => {
        const closed = { ...frozenTopic(), id: 'legacy-1', status: 'published', published_at: PUBLISH_AT };
        const piece = {
            id: 'mf6', topic_id: 'legacy-1', piece_type: 'short_1', status: 'publishing',
            video_url: 'https://cdn/v.mp4', carousel_url: null,
            published_platforms: { tiktok: '7515111459437677866', youtube: 'FP-rMB-EGsU' },
        };
        const supabase = makeSupabaseMock([closed], { 'legacy-1': [piece] }, calls);

        await pollBlotatoStatuses(supabase as never, AFTER_WINDOW);

        expect(piece.status).toBe('published');
    });
});

/**
 * The original incident's defining property was silence: 5 days at
 * status='publishing' with nothing published, no alert, and no operator-visible
 * hint. Holds are correct when taken, so the guard against that is a clock.
 */
describe('pollBlotatoStatuses — the stuck-hold watchdog', () => {
    let calls: Recorded;
    beforeEach(() => {
        vi.clearAllMocks();
        calls = { topicUpdates: [], pieceUpdates: [] };
    });

    /** publish_at NULL and publish_date NULL: unbounded on the publisher side,
     *  no anchor to repair — the residual hold-forever shape. */
    const unanchored = () => ({
        ...frozenTopic(), id: 'stuck-1', publish_at: null, publish_date: null,
        published_at: '2026-07-21T13:00:00.000Z', status: 'partially_published',
    });

    const pendingForever = () => [{
        id: 'sp1', topic_id: 'stuck-1', piece_type: 'short_1', status: 'publishing',
        video_url: 'https://cdn/v.mp4', carousel_url: null,
        published_platforms: { tiktok: { status: 'pending', post_id: 'never-resolves' } },
    }];

    it('stays quiet while the hold is young', async () => {
        const supabase = makeSupabaseMock([unanchored()], { 'stuck-1': pendingForever() }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'processing' } as never);

        const result = await pollBlotatoStatuses(supabase as never, at(STUCK_HOLD_ALERT_HOURS - 2));

        expect(result.stuckTopics).toBe(0);
        expect(notifyError).not.toHaveBeenCalled();
    });

    // A topic pulled in only because it owns a mid-flight piece is still the
    // publisher's business. The marker write is guarded on the open statuses,
    // so alerting on one of these would never record anything — and would
    // therefore fire again on every 10-minute tick, forever.
    it('never alerts on a topic that is not this pass to settle', async () => {
        const bouncedBack = { ...unanchored(), status: 'scheduled', error_message: null };
        const supabase = makeSupabaseMock([bouncedBack], { 'stuck-1': pendingForever() }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'processing' } as never);

        const result = await pollBlotatoStatuses(supabase as never, at(24 * 30));

        expect(result.stuckTopics).toBe(0);
        expect(notifyError).not.toHaveBeenCalled();
        expect(calls.topicUpdates).toHaveLength(0);
    });

    it('alerts once when a topic has been held too long', async () => {
        const topic = unanchored();
        const supabase = makeSupabaseMock([topic], { 'stuck-1': pendingForever() }, calls);
        vi.mocked(blotato.getPostStatus).mockResolvedValue({ status: 'processing' } as never);

        const first = await pollBlotatoStatuses(supabase as never, at(STUCK_HOLD_ALERT_HOURS + 1));
        expect(first.stuckTopics).toBe(1);
        expect(notifyError).toHaveBeenCalledTimes(1);
        expect(String(topic.error_message)).toContain('Held by check-status');

        // Same hold on the next tick: the marker is already on the row, so no
        // second write and no second email.
        const second = await pollBlotatoStatuses(supabase as never, at(STUCK_HOLD_ALERT_HOURS + 2));
        expect(second.stuckTopics).toBe(0);
        expect(notifyError).toHaveBeenCalledTimes(1);
    });
});
