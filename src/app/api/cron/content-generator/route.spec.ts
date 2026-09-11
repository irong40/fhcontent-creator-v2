import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ generate: vi.fn(), updates: [] as Record<string, unknown>[], inserts: [] as unknown[], existing: 0 }));
vi.mock('@/lib/content-inference', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/content-inference')>(), generateQueuedContent: state.generate }));
vi.mock('@/lib/local-inference-queue', () => ({ LocalInferencePendingError: class extends Error {} }));
vi.mock('@/lib/prompts', () => ({ buildContentPrompt: () => ({ system: 'system', user: 'source' }) }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn() }));
vi.mock('@/lib/workflow-lock', () => ({ acquireLock: async () => 'lock', releaseLock: vi.fn() }));
vi.mock('../middleware', () => ({ validateCronSecret: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (table: string) => {
    let response: unknown = { error: null };
    const chain = {
        select: (_fields?: string, options?: unknown) => { if (options) response = { count: state.existing }; return chain; },
        eq: () => chain, not: () => chain, or: () => chain, order: () => chain,
        limit: () => { response = { data: [{ id: 'fixture', title: 'Source', retry_count: 0, personas: { name: 'Fixture', content_format: 'standard' } }], error: null }; return chain; },
        update: (value: Record<string, unknown>) => { state.updates.push(value); return chain; },
        insert: (value: unknown) => { if (table === 'content_pieces') state.inserts.push(value); return chain; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
    }; return chain;
} }) }));
import { GET } from './route';
import { LocalInferencePendingError } from '@/lib/local-inference-queue';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.updates.length = 0; state.inserts.length = 0; state.existing = 0; });
describe('local content consumption', () => {
    it('leaves queued work selectable without charging retries or inserting content', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.generate.mockRejectedValue(new LocalInferencePendingError('fixture'));
        const response = await GET(new Request('https://fixture/api/cron/content-generator'));
        expect((await response.json()).results[0].queued).toBe(true);
        expect(state.updates).toEqual([{ status: 'draft', error_message: null }]);
        expect(state.inserts).toHaveLength(0);
    });
    it('inserts a complete batch together and holds local output for review', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        const response = await GET(new Request('https://fixture/api/cron/content-generator'));
        expect((await response.json()).results[0].piecesInserted).toBe(6);
        expect(state.inserts).toHaveLength(1);
        expect(state.inserts[0]).toHaveLength(6);
        expect(state.updates.at(-1)).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
    });
    it('recovers existing pieces to review without generating or autoapproving', async () => {
        state.existing = 6;
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate).not.toHaveBeenCalled();
        expect(state.updates[0]).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
    });
});
