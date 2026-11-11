import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ stale: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] }));
vi.mock('@/lib/claude', () => ({ claude: {} }));
vi.mock('@/lib/guardrail', () => ({ verifyTopicAgainstNotebookLM: vi.fn(), hasGuardrail: () => false }));
vi.mock('@/lib/sourced-topics', () => ({ isSourced: () => false, takeCandidates: vi.fn(), claimCandidate: vi.fn(), settleCandidate: vi.fn(), releaseCandidateOfTopic: vi.fn(), NO_CANDIDATES: 'none' }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn() }));
vi.mock('@/lib/workflow-lock', () => ({ acquireLock: async () => 'lock', releaseLock: vi.fn() }));
vi.mock('../middleware', () => ({ validateCronSecret: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (table: string) => {
    let response: unknown = { data: [], error: null };
    const chain = {
        select: (fields?: string) => {
            if (table === 'personas') response = { data: [{ id: 'p1', name: 'Fixture' }], error: null };
            else if (fields?.includes('content_pieces')) response = { data: state.stale, error: null };
            else response = { data: [{ id: 'existing' }], error: null };
            return chain;
        },
        eq: () => chain, in: () => chain, lt: () => chain, gte: () => chain, or: () => chain, order: () => chain, limit: () => chain,
        update: (value: Record<string, unknown>) => { if (table === 'topics') state.updates.push(value); return chain; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
    }; return chain;
} }) }));
import { GET } from './route';
afterEach(() => { vi.unstubAllEnvs(); state.stale = []; state.updates.length = 0; });
async function sweep(stale: Record<string, unknown>[]) {
    vi.stubEnv('AUTO_TOPIC_PERSONA_IDS', 'p1');
    state.stale = stale;
    await GET(new Request('https://fixture/api/cron/daily-topic'));
}
describe('stale draft sweep', () => {
    it('fails a draft with no text and no review hold', async () => {
        await sweep([{ id: 't1', status: 'draft', requires_review: false, content_pieces: [] }]);
        expect(state.updates).toHaveLength(1);
        expect(state.updates[0]).toMatchObject({ status: 'failed' });
    });
    it('spares a topic that already has content pieces', async () => {
        await sweep([{ id: 't2', status: 'draft', requires_review: false, content_pieces: [{ id: 'c1' }] }]);
        expect(state.updates).toHaveLength(0);
    });
    it('spares a topic held for review', async () => {
        await sweep([{ id: 't3', status: 'draft', requires_review: true, content_pieces: [] }]);
        expect(state.updates).toHaveLength(0);
    });
});
