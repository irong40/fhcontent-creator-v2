import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), text: vi.fn(), structured: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/draft-cache', async (orig) => ({ ...(await orig<typeof import('@/lib/draft-cache')>()), readCachedDraft: mocks.read, writeCachedDraft: mocks.write }));
vi.mock('@/lib/local-inference-queue', () => ({ getOrEnqueueLocalInference: mocks.queue }));
vi.mock('@/lib/claude', () => ({ claude: { generateContent: mocks.text, generateStructured: mocks.structured } }));
import { generateQueuedContent, localContentResponseSchema } from './content-inference';

const request = { requestKey: 'fixture', system: 'system', user: 'source', maxTokens: 100 };
beforeEach(() => { mocks.write.mockImplementation(async (_k: string, d: unknown) => d); });
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
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
    it('stores a fresh hosted draft and reuses it on the next pass instead of paying for a different one', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        mocks.read.mockResolvedValueOnce(null);
        mocks.write.mockImplementation(async (_k: string, d: unknown) => d);
        mocks.text.mockResolvedValue({ text: 'draft A', inputTokens: 3, outputTokens: 1 });
        const first = await generateQueuedContent(request);
        expect(first.text).toBe('draft A');
        expect(mocks.write).toHaveBeenCalledTimes(1);
        const [key, stored] = mocks.write.mock.calls[0];
        expect(stored).toEqual({ text: 'draft A', inputTokens: 3, outputTokens: 1 });
        mocks.read.mockResolvedValueOnce(stored);
        const second = await generateQueuedContent(request);
        expect(second).toEqual({ text: 'draft A', inputTokens: 3, outputTokens: 1, provider: 'claude' });
        expect(mocks.text).toHaveBeenCalledTimes(1);
        expect(mocks.read.mock.calls[1][0]).toBe(key);
    });
    it('falls back to a fresh draft when the cache read errors', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.read.mockRejectedValueOnce(new Error('Draft cache read failed (57014)'));
        mocks.text.mockResolvedValue({ text: 'fresh', inputTokens: 2, outputTokens: 1 });
        expect(await generateQueuedContent(request)).toEqual({ text: 'fresh', inputTokens: 2, outputTokens: 1, provider: 'claude' });
        expect(mocks.text).toHaveBeenCalledTimes(1);
    });
    it('keys the cached draft on topic, retry and prompt', async () => {
        const { draftCacheKey } = await vi.importActual<typeof import('@/lib/draft-cache')>('@/lib/draft-cache');
        const base = draftCacheKey('content:t:pieces:0', 's', 'u', 100);
        expect(base).toMatch(/^[0-9a-f]{64}$/);
        expect(draftCacheKey('content:t:pieces:0', 's', 'u', 100)).toBe(base);
        expect(draftCacheKey('content:t:pieces:1', 's', 'u', 100)).not.toBe(base);
        expect(draftCacheKey('content:t:pieces:0', 's', 'u2', 100)).not.toBe(base);
        expect(draftCacheKey('content:t:pieces:0', 's', 'u', 200)).not.toBe(base);
    });
});
