import { describe, it, expect } from 'vitest';
import { isSourced, takeCandidates, settleCandidate, sourceDiscipline } from './sourced-topics';
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

    it('creates nothing when the table cannot be read', async () => {
        const { db } = fakeDb([], { message: 'boom' });
        expect(await takeCandidates(db, 'p', 7)).toEqual({ topics: [], problems: ['Topic candidates could not be read: boom'] });
    });

    it('returns no topics when none are ready, and never a made-up one', async () => {
        const { db } = fakeDb([]);
        expect(await takeCandidates(db, 'p', 7)).toEqual({ topics: [], problems: [] });
    });
});

describe('settleCandidate', () => {
    it('marks a candidate used with the topic it became', async () => {
        const { db, calls } = fakeDb([]);
        await settleCandidate(db, 'cand-1', { topicId: 'topic-9' });
        const patch = calls.find(c => c.op === 'update')?.args[0] as Record<string, unknown>;
        expect(patch.status).toBe('used');
        expect(patch.topic_id).toBe('topic-9');
        expect(calls.filter(c => c.op === 'eq').map(c => c.args)).toEqual([['id', 'cand-1'], ['status', 'ready']]);
    });

    it('marks a duplicate discarded', async () => {
        const { db, calls } = fakeDb([]);
        await settleCandidate(db, 'cand-1', { discarded: true });
        const patch = calls.find(c => c.op === 'update')?.args[0] as Record<string, unknown>;
        expect(patch.status).toBe('discarded');
        expect(patch.topic_id).toBeUndefined();
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
