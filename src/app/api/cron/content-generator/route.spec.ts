import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ generate: vi.fn(), judge: vi.fn(), release: vi.fn(), updates: [] as Record<string, unknown>[], inserts: [] as unknown[], existing: 0, topic: {} as Record<string, unknown> }));
vi.mock('@/lib/content-inference', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/content-inference')>(), generateQueuedContent: state.generate }));
vi.mock('@/lib/claim-check', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/claim-check')>(), callJudge: state.judge }));
vi.mock('@/lib/local-inference-queue', () => ({ LocalInferencePendingError: class extends Error {} }));
vi.mock('@/lib/prompts', () => ({ buildContentPrompt: () => ({ system: 'system', user: 'source' }) }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn() }));
vi.mock('@/lib/draft-hold', () => ({ releaseDraftHolds: state.release }));
vi.mock('@/lib/workflow-lock', () => ({ acquireLock: async () => 'lock', releaseLock: vi.fn() }));
vi.mock('../middleware', () => ({ validateCronSecret: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (table: string) => {
    let response: unknown = { error: null };
    const chain = {
        select: (_fields?: string, options?: unknown) => { if (options) response = { count: state.existing }; return chain; },
        eq: () => chain, not: () => chain, or: () => chain, order: () => chain,
        limit: () => { response = { data: [{ id: 'fixture', title: 'Source', retry_count: 0, personas: { name: 'Fixture', content_format: 'standard' }, ...state.topic }], error: null }; return chain; },
        update: (value: Record<string, unknown>) => { state.updates.push(value); return chain; },
        insert: (value: unknown) => { if (table === 'content_pieces') state.inserts.push(value); return chain; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
    }; return chain;
} }) }));
import { GET } from './route';
import { LocalInferencePendingError } from '@/lib/local-inference-queue';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.updates.length = 0; state.inserts.length = 0; state.existing = 0; state.topic = {}; });
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
    it('holds cloud output for review too; never writes scheduled past the source gate', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.updates.at(-1)).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
        expect(state.updates.some(u => u.status === 'scheduled')).toBe(false);
    });
    const sourcedPieces = () => ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: 'James was a double agent for the British' }));
    const lafayettePoint = { claim: 'James pretended to spy for the British but repeated to Lafayette what he overheard.', quote: 'James pretended to spy for the British but repeated to Lafayette what he overheard.', source: 'DVB', year: '1781' };

    const gen = () => state.generate.mockResolvedValueOnce({ text: JSON.stringify({ pieces: sourcedPieces() }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });

    it('rejects a sourced draft when the judge finds one piece unsupported, and says why', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        gen();
        state.judge
            .mockResolvedValueOnce('{"unsupported":[]}')
            .mockResolvedValueOnce('{"unsupported":[{"claim":"double agent for the British","reason":"he only pretended"}]}')
            .mockResolvedValue('{"unsupported":[]}');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.judge).toHaveBeenCalledTimes(6); // one call per piece
        expect(state.inserts).toHaveLength(0);
        const fault = state.updates.at(-1) as { status: string; error_message: string };
        expect(fault.status).toBe('draft');
        expect(fault.error_message).toContain('Unsupported claim');
        expect(fault.error_message).toContain('short_1');
    });

    it('rejects a sourced draft when the claim check gives no verdict', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        gen();
        state.judge.mockResolvedValue('Looks fine');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.inserts).toHaveLength(0);
    });

    it('inserts a sourced draft every piece of which the judge finds clean', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        gen();
        state.judge.mockResolvedValue('{"unsupported":[]}');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.judge).toHaveBeenCalledTimes(6);
        expect(state.inserts).toHaveLength(1);
    });

    it('rejects a sourced draft that quotes words no source holds, and says why on the retry', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        const passage = 'now I am sick and tired of being sick and tired, and we want a change.';
        state.topic = { historical_points: [{ claim: passage, quote: passage, source: 'Speech', year: '1964' }] };
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: pieceType === 'long' ? "Her words: 'I'm sick and tired of being sick and tired.'" : 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.inserts).toHaveLength(0);
        const fault = state.updates.at(-1) as { status: string; error_message: string };
        expect(fault.status).toBe('draft');
        expect(fault.error_message).toContain('Unsourced quotation');
        state.updates.length = 0;
        state.topic = { ...state.topic, retry_count: 1, error_message: fault.error_message };
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate.mock.calls.at(-1)?.[0].user).toContain('A PREVIOUS DRAFT WAS REJECTED');
    });
    it('recovers existing pieces to review without generating or autoapproving', async () => {
        state.existing = 6;
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate).not.toHaveBeenCalled();
        expect(state.updates[0]).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
    });

    // 2026-10-22: a hosted draft is held while the claim judge works, then released.
    describe('draft holds', () => {
        const passPieces = () => sourcedPieces().map(p => ({ ...p, captionShort: 'caption' }));
        it('asks for a held draft, and keeps it while the judge has not answered', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockRejectedValue(Object.assign(new LocalInferencePendingError('judge'), { name: 'LocalInferencePendingError' }));
            const body = await (await GET(new Request('https://fixture/api/cron/content-generator'))).json();
            expect(state.generate.mock.calls[0][0]).toMatchObject({ holdForTopic: 'fixture' });
            expect(body.results[0].queued).toBe(true);
            expect(state.release).not.toHaveBeenCalled();
            expect(state.inserts).toHaveLength(0);
        });
        it('releases the held draft when the attempt passes', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.inserts).toHaveLength(1);
            expect(state.release).toHaveBeenCalledWith('fixture');
        });
        it('releases the held draft when the attempt fails, so the retry gets a new one', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[{"claim":"x","reason":"y"}]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.inserts).toHaveLength(0);
            expect(state.release).toHaveBeenCalledWith('fixture');
            expect(state.updates.at(-1)).toMatchObject({ status: 'draft', retry_count: 1 });
        });
        it('holds the quote video captions draft too', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { title: 'Figure: Words', personas: { name: 'Fixture', content_format: 'quote_video' }, historical_points: [{ ...lafayettePoint, claim: 'Words spoken here.' }] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ captionLong: 'caption', captionShort: 'caption' }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.generate.mock.calls[0][0]).toMatchObject({ holdForTopic: 'fixture' });
        });
    });
});
