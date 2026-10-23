import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), text: vi.fn(), structured: vi.fn() }));
vi.mock('@/lib/local-inference-queue', () => ({ getOrEnqueueLocalInference: mocks.queue }));
vi.mock('@/lib/claude', () => ({ claude: { generateContent: mocks.text, generateStructured: mocks.structured } }));
// Held drafts in memory, with the real key function (2026-10-22).
const holds = vi.hoisted(() => new Map<string, { text: string; inputTokens: number; outputTokens: number }>());
vi.mock('@/lib/draft-hold', async importOriginal => ({
    ...await importOriginal<typeof import('@/lib/draft-hold')>(),
    readHeldDraft: async (key: string) => holds.get(key) ?? null,
    holdDraft: async (key: string, _topic: string, draft: { text: string; inputTokens: number; outputTokens: number }) => { holds.set(key, draft); },
}));
import { generateQueuedContent, localContentResponseSchema } from './content-inference';

const request = { requestKey: 'fixture', system: 'system', user: 'source', maxTokens: 100 };
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); holds.clear(); });
describe('content provider routing', () => {
    it('bounds image prompts so repeated framing instructions cannot grow indefinitely', () => {
        const pieces = ['long','short_1','short_2','short_3','short_4','carousel'].map(pieceType => ({pieceType,script:'draft',captionLong:'caption',captionShort:'caption',thumbnailPrompt:'x'.repeat(700)}));
        expect(localContentResponseSchema.safeParse({pieces}).success).toBe(true);
        pieces[0].thumbnailPrompt += 'x';
        expect(localContentResponseSchema.safeParse({pieces}).success).toBe(false);
    });
    it('uses queued local output with provider and usage provenance', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        mocks.queue.mockResolvedValue({ text: '{}', inputTokens: 5, outputTokens: 2 });
        expect(await generateQueuedContent(request)).toEqual({ text: '{}', inputTokens: 5, outputTokens: 2, provider: 'ollama' });
        expect(mocks.text).not.toHaveBeenCalled();
        expect(mocks.structured).not.toHaveBeenCalled();
    });
    it('propagates offline/pending errors without paid fallback', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        const pending = new Error('pending');
        mocks.queue.mockRejectedValue(pending);
        await expect(generateQueuedContent(request)).rejects.toBe(pending);
        expect(mocks.text).not.toHaveBeenCalled();
        expect(mocks.structured).not.toHaveBeenCalled();
    });
    it('rejects misspelled providers instead of buying hosted inference', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'olama');
        await expect(generateQueuedContent(request)).rejects.toThrow('Invalid');
        expect(mocks.text).not.toHaveBeenCalled();
    });
    it('preserves the explicitly selected hosted text path', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        mocks.text.mockResolvedValue({ text: 'draft', inputTokens: 3, outputTokens: 1 });
        expect((await generateQueuedContent(request)).provider).toBe('claude');
        expect(mocks.queue).not.toHaveBeenCalled();
    });
    it('normalizes hosted structured output to the same contract', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        mocks.structured.mockResolvedValue({ data: { captionLong: 'draft' }, inputTokens: 3, outputTokens: 1 });
        expect((await generateQueuedContent({ ...request, schema: { type: 'object' } })).text).toBe('{"captionLong":"draft"}');
    });
});

// 2026-10-22: Claude wrote a new draft every cron run, so a sourced draft's judge jobs (keyed by
// its text) were never read back. Du Bois made 33 judge jobs in 16 hours and never moved.
describe('a hosted draft held for its topic', () => {
    it('is bought once and checked again on the next run while the judge works', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        mocks.text.mockResolvedValueOnce({ text: 'first draft', inputTokens: 3, outputTokens: 1 })
            .mockResolvedValueOnce({ text: 'second draft', inputTokens: 3, outputTokens: 1 });
        const first = await generateQueuedContent({ ...request, holdForTopic: 't1' });
        const next = await generateQueuedContent({ ...request, holdForTopic: 't1' });
        expect(next).toEqual(first);
        expect(next.text).toBe('first draft');
        expect(mocks.text).toHaveBeenCalledTimes(1);
    });
    it('is a new draft for a new attempt (a retry changes the request)', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        mocks.structured.mockResolvedValueOnce({ data: { a: 1 }, inputTokens: 3, outputTokens: 1 })
            .mockResolvedValueOnce({ data: { a: 2 }, inputTokens: 3, outputTokens: 1 });
        const schema = { type: 'object' };
        await generateQueuedContent({ ...request, schema, holdForTopic: 't1' });
        const retry = await generateQueuedContent({ ...request, requestKey: 'fixture:1', schema, holdForTopic: 't1' });
        expect(retry.text).toBe('{"a":2}');
        expect(mocks.structured).toHaveBeenCalledTimes(2);
    });
    it('is not held without a topic, and the local queue never sees the topic field', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        mocks.text.mockResolvedValue({ text: 'draft', inputTokens: 3, outputTokens: 1 });
        await generateQueuedContent(request);
        await generateQueuedContent(request);
        expect(mocks.text).toHaveBeenCalledTimes(2);
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        mocks.queue.mockResolvedValue({ text: '{}', inputTokens: 5, outputTokens: 2 });
        await generateQueuedContent({ ...request, holdForTopic: 't1' });
        expect(mocks.queue).toHaveBeenCalledWith(request);
    });
});
