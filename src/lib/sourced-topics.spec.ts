import { describe, it, expect } from 'vitest';
import { isSourced, takeCandidates, claimCandidate, settleCandidate, sourceDiscipline, CANDIDATE_READ_LIMIT } from './sourced-topics';
import { buildContentPrompt } from './prompts';

type Call = { table: string; op: string; args: unknown[] };

function fakeDb(rows: unknown[], error: { message: string } | null = null) {
    const calls: Call[] = [];
    const from = (table: string) => {
        const b: Record<string, unknown> = {};
        for (const op of ['select', 'eq', 'order', 'update']) {
            b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b; };
        }
        b.limit = (...args: unknown[]) => {
            calls.push({ table, op: 'limit', args });
            return Promise.resolve({ data: rows, error });
        };
        return b;
    };
    return { db: { from } as never, calls };
}

const point = (n: number, extra: Record<string, unknown> = {}) => ({
    point: n,
    claim: `Claim ${n}`,
    source: 'Dictionary of Virginia Biography',
    year: '1867',
    url: 'https://www.lva.virginia.gov/collections/dvb/bio/bayne-thomas',
    quote: `Passage ${n} as the page prints it.`,
    ...extra,
});
const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: ` Topic ${id} `,
    hook: 'A hook.',
    historical_points: [point(1), point(2), point(3), point(4)],
    thumbnail_prompt: 'A scene',
    ...extra,
});

describe('isSourced', () => {
    it('is true only for the sourced guardrail', () => {
        expect(isSourced({ content_guardrail: 'sourced' })).toBe(true);
        expect(isSourced({ content_guardrail: ' Sourced ' })).toBe(true);
        expect(isSourced({ content_guardrail: 'none' })).toBe(false);
        expect(isSourced({ content_guardrail: 'notebooklm' })).toBe(false);
        expect(isSourced({ content_guardrail: null })).toBe(false);
        expect(isSourced({})).toBe(false);
    });
});

describe('takeCandidates', () => {
    it('asks only for ready candidates of that persona, oldest first', async () => {
        const { db, calls } = fakeDb([row('a')]);
        await takeCandidates(db, 'persona-1', 7);
        expect(calls[0].table).toBe('topic_candidates');
        expect(calls.filter(c => c.op === 'eq').map(c => c.args)).toEqual([['persona_id', 'persona-1'], ['status', 'ready']]);
        expect(calls.find(c => c.op === 'order')?.args).toEqual(['created_at', { ascending: true }]);
    });

    it('returns each candidate with its four sourced points', async () => {
        const { db } = fakeDb([row('a'), row('b')]);
        const { topics, problems } = await takeCandidates(db, 'p', 7);
        expect(problems).toEqual([]);
        expect(topics.map(t => t.candidateId)).toEqual(['a', 'b']);
        expect(topics[0].title).toBe('Topic a');
        expect(topics[0].historicalPoints).toHaveLength(4);
        expect(topics[0].historicalPoints[0].url).toContain('lva.virginia.gov');
        expect(topics[0].thumbnailPrompt).toBe('A scene');
    });

    it('stops at the count', async () => {
        const { db } = fakeDb(['a', 'b', 'c'].map(id => row(id)));
        expect((await takeCandidates(db, 'p', 2)).topics.map(t => t.candidateId)).toEqual(['a', 'b']);
    });

    it('skips a candidate without four sourced points and says so', async () => {
        const { db } = fakeDb([
            row('three', { historical_points: [point(1), point(2), point(3)] }),
            row('nourl', { historical_points: [point(1), point(2), point(3), point(4, { url: 'not a link' })] }),
            row('noquote', { historical_points: [point(1), point(2), point(3), point(4, { quote: '  ' })] }),
            row('notitle', { title: ' ' }),
            row('good'),
        ]);
        const { topics, problems } = await takeCandidates(db, 'p', 7);
        expect(topics.map(t => t.candidateId)).toEqual(['good']);
        expect(problems).toHaveLength(4);
        expect(problems[0]).toContain('three');
    });

    it('finds the good candidates behind a long run of bad ones', async () => {
        const bad = Array.from({ length: 20 }, (_, i) => row(`bad${i}`, { historical_points: [] }));
        const { db, calls } = fakeDb([...bad, row('good1'), row('good2')]);
        const { topics, problems } = await takeCandidates(db, 'p', 7);
        expect(topics.map(t => t.candidateId)).toEqual(['good1', 'good2']);
        expect(problems).toHaveLength(20);
        expect(calls.find(c => c.op === 'limit')?.args).toEqual([CANDIDATE_READ_LIMIT]);
        expect(CANDIDATE_READ_LIMIT).toBeGreaterThanOrEqual(100);
    });

    it('creates nothing when the table cannot be read', async () => {
        const { db } = fakeDb([], { message: 'boom' });
        expect(await takeCandidates(db, 'p', 7)).toEqual({ topics: [], problems: ['Topic candidates could not be read: boom'] });
    });

    it('returns no topics when none are ready, and never a made-up one', async () => {
        const { db } = fakeDb([]);
        expect(await takeCandidates(db, 'p', 7)).toEqual({ topics: [], problems: [] });
    });
});

/** A one-table stand-in that really applies updates, so a claim can be tested against a second claim. */
function candidateTable(rows: Array<Record<string, unknown>>, failWith: string | null = null) {
    const from = () => {
        let patch: Record<string, unknown> = {};
        const filters: Array<(r: Record<string, unknown>) => boolean> = [];
        const b: Record<string, unknown> = {
            update: (p: Record<string, unknown>) => { patch = p; return b; },
            eq: (col: string, val: unknown) => { filters.push(r => r[col] === val); return b; },
            is: (col: string, val: unknown) => { filters.push(r => (r[col] ?? null) === val); return b; },
            select: async () => {
                if (failWith) return { data: null, error: { message: failWith } };
                const hit = rows.filter(r => filters.every(f => f(r)));
                hit.forEach(r => Object.assign(r, patch));
                return { data: hit.map(r => ({ id: r.id })), error: null };
            },
        };
        return b;
    };
    return { from } as never;
}

describe('claimCandidate', () => {
    it('takes a ready candidate once, and a second run cannot take it again', async () => {
        const rows = [{ id: 'cand-1', status: 'ready', topic_id: null, used_at: null }];
        const db = candidateTable(rows);
        expect(await claimCandidate(db, 'cand-1')).toBe(true);
        expect(rows[0].status).toBe('used');
        expect(rows[0].used_at).toEqual(expect.any(String));
        expect(await claimCandidate(db, 'cand-1')).toBe(false);
    });

    it('does not take a candidate that is used, discarded or missing', async () => {
        const rows = [{ id: 'used', status: 'used' }, { id: 'gone', status: 'discarded' }];
        const db = candidateTable(rows);
        expect(await claimCandidate(db, 'used')).toBe(false);
        expect(await claimCandidate(db, 'gone')).toBe(false);
        expect(await claimCandidate(db, 'nope')).toBe(false);
    });

    it('is not a claim when the database refuses', async () => {
        const rows = [{ id: 'cand-1', status: 'ready' }];
        expect(await claimCandidate(candidateTable(rows, 'boom'), 'cand-1')).toBe(false);
        expect(rows[0].status).toBe('ready');
    });
});

describe('settleCandidate', () => {
    const claimed = () => [{ id: 'cand-1', status: 'used', topic_id: null as string | null, used_at: '2026-10-11T02:00:00Z' as string | null }];

    it('links a claimed candidate to the topic it became, once', async () => {
        const rows = claimed();
        const db = candidateTable(rows);
        expect(await settleCandidate(db, 'cand-1', { topicId: 'topic-9' })).toBe(true);
        expect(rows[0]).toMatchObject({ status: 'used', topic_id: 'topic-9' });
        // a second topic can never be hung on the same candidate
        expect(await settleCandidate(db, 'cand-1', { topicId: 'topic-10' })).toBe(false);
        expect(rows[0].topic_id).toBe('topic-9');
    });

    it('discards a claimed candidate the duplicate check refused', async () => {
        const rows = claimed();
        expect(await settleCandidate(candidateTable(rows), 'cand-1', { discarded: true })).toBe(true);
        expect(rows[0]).toMatchObject({ status: 'discarded', topic_id: null });
    });

    it('gives a claimed candidate back when no topic came of it', async () => {
        const rows = claimed();
        const db = candidateTable(rows);
        expect(await settleCandidate(db, 'cand-1', { released: true })).toBe(true);
        expect(rows[0]).toMatchObject({ status: 'ready', used_at: null, topic_id: null });
        expect(await claimCandidate(db, 'cand-1')).toBe(true);
    });

    it('never gives back a candidate that already became a topic', async () => {
        const rows = [{ id: 'cand-1', status: 'used', topic_id: 'topic-9', used_at: 'x' }];
        expect(await settleCandidate(candidateTable(rows), 'cand-1', { released: true })).toBe(false);
        expect(rows[0]).toMatchObject({ status: 'used', topic_id: 'topic-9' });
    });

    it('touches nothing that was not claimed, and says so', async () => {
        const rows = [{ id: 'cand-1', status: 'ready', topic_id: null }];
        expect(await settleCandidate(candidateTable(rows), 'cand-1', { topicId: 'topic-9' })).toBe(false);
        expect(rows[0]).toMatchObject({ status: 'ready', topic_id: null });
        expect(await settleCandidate(candidateTable(rows, 'boom'), 'cand-1', { discarded: true })).toBe(false);
    });
});

describe('the script prompt for a sourced topic', () => {
    const persona = {
        name: 'Dr. Imani Carter', brand: 'History Unveiled VA', voice_style: 'warm', content_guidelines: null,
        content_format: 'standard', newsletter_cta: null, image_subject_constraint: null,
    } as unknown as Parameters<typeof buildContentPrompt>[0];
    const topic = (points: unknown[]) => ({
        title: 'Thomas Bayne: The Dentist', hook: 'A hook.', historical_points: points,
    }) as unknown as Parameters<typeof buildContentPrompt>[1];

    it('shows each source passage and the discipline rule', () => {
        const { user } = buildContentPrompt(persona, topic([point(1), point(2), point(3), point(4)]));
        expect(user).toContain('1. Claim 1 (Source: Dictionary of Virginia Biography, 1867)\n   SOURCE PASSAGE: "Passage 1 as the page prints it."');
        expect(user).toContain('SOURCE DISCIPLINE');
        expect(user).toContain('Add none from memory.');
        expect(user.indexOf('SOURCE DISCIPLINE')).toBeLessThan(user.indexOf('Generate content for 6 pieces'));
    });

    it('is unchanged for a topic with no source passages', () => {
        const plain = [1, 2, 3, 4].map(n => ({ point: n, claim: `Claim ${n}`, source: 'A book', year: '1900' }));
        const { user } = buildContentPrompt(persona, topic(plain));
        expect(user).not.toContain('SOURCE PASSAGE');
        expect(user).not.toContain('SOURCE DISCIPLINE');
        expect(user).toContain('4. Claim 4 (Source: A book, 1900)\n\nGenerate content for 6 pieces:');
    });

    it('gives no rule when no point carries a passage', () => {
        expect(sourceDiscipline([{}, { quote: '' }, { quote: null }])).toBe('');
        expect(sourceDiscipline([{ quote: 'A passage.' }])).toContain('SOURCE DISCIPLINE');
    });
});
