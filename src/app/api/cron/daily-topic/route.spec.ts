import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stale: [] as Record<string, unknown>[], staleError: null as { message: string } | null, updates: [] as Record<string, unknown>[], released: [] as string[] }));
vi.mock('@/lib/claude', () => ({ claude: {} }));
vi.mock('@/lib/guardrail', () => ({ verifyTopicAgainstNotebookLM: vi.fn(), hasGuardrail: () => false }));
vi.mock('@/lib/sourced-topics', () => ({ isSourced: () => false, takeCandidates: vi.fn(), claimCandidate: vi.fn(), settleCandidate: vi.fn(), releaseCandidateOfTopic: async (_db: unknown, id: string) => { state.released.push(id); }, NO_CANDIDATES: 'none' }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn() }));
vi.mock('@/lib/workflow-lock', () => ({ acquireLock: async () => 'lock', releaseLock: vi.fn() }));
vi.mock('../middleware', () => ({ validateCronSecret: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (table: string) => {
    let response: unknown = { data: [], error: null };
    const chain = {
        select: (fields?: string) => {
            if (table === 'personas') response = { data: [{ id: 'p1', name: 'Fixture' }], error: null };
            else if (fields?.includes('content_pieces')) response = { data: state.staleError ? null : state.stale, error: state.staleError };
            else response = { data: [{ id: 'existing' }], error: null };
            return chain;
        },
        eq: () => chain, in: () => chain, lt: () => chain, gte: () => chain, or: () => chain, order: () => chain, limit: () => chain,
        update: (value: Record<string, unknown>) => { if (table === 'topics') state.updates.push(value); return chain; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
    }; return chain;
} }) }));
import { GET } from './route';
afterEach(() => { vi.unstubAllEnvs(); state.stale = []; state.staleError = null; state.updates.length = 0; state.released.length = 0; });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
async function sweep(stale: Record<string, unknown>[]) {
    vi.stubEnv('AUTO_TOPIC_PERSONA_IDS', 'p1');
    state.stale = stale;
    return (await GET(new Request('https://fixture/api/cron/daily-topic'))).json();
}
describe('stale draft sweep', () => {
    it('fails a draft with no text and no review hold', async () => {
        await sweep([{ id: 't1', status: 'draft', requires_review: false, content_pieces: [] }]);
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0]).toMatchObject({ status: 'failed' });
        expect(state.released).toEqual(['t1']);
    });
    it('spares a topic that already has content pieces', async () => {
        await sweep([{ id: 't2', status: 'draft', requires_review: false, content_pieces: [{ id: 'c1' }] }]);
        expect(state.updates).toHaveLength(0);
    });
    it('spares a topic held for review inside the grace week', async () => {
        await sweep([{ id: 't3', status: 'draft', requires_review: true, publish_date: daysAgo(1), content_pieces: [] }]);
        expect(state.updates).toHaveLength(0);
        expect(state.released).toHaveLength(0);
    });
    it('fails a held draft with no text once the grace week is over, and releases its candidate', async () => {
        await sweep([{ id: 't4', status: 'draft', requires_review: true, publish_date: daysAgo(8), content_pieces: [] }]);
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0]).toMatchObject({ status: 'failed' });
        expect(state.updates[0].error_message).toContain('held for review with no text');
        expect(state.released).toEqual(['t4']);
    });
    it('falls back to created_at for a held draft with no publish date', async () => {
        await sweep([
            { id: 't5', status: 'draft', requires_review: true, publish_date: null, created_at: `${daysAgo(8)}T09:00:00Z`, content_pieces: [] },
            { id: 't6', status: 'draft', requires_review: true, publish_date: null, created_at: `${daysAgo(2)}T09:00:00Z`, content_pieces: [] },
        ]);
        expect(state.released).toEqual(['t5']);
    });
    it('spares a held draft with text even long past its date', async () => {
        await sweep([{ id: 't7', status: 'draft', requires_review: true, publish_date: daysAgo(30), content_pieces: [{ id: 'c7' }] }]);
        expect(state.updates).toHaveLength(0);
        expect(state.released).toHaveLength(0);
    });
    it('reports a failed stale-draft read instead of passing silently', async () => {
        state.staleError = { message: 'embed failed' };
        const body = await sweep([]);
        expect(body.results[0].errors).toContain('Stale-draft sweep: embed failed');
    });
});
