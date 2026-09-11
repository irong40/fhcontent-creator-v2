import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queue: vi.fn(), text: vi.fn(), structured: vi.fn() }));
vi.mock('@/lib/local-inference-queue', () => ({ getOrEnqueueLocalInference: mocks.queue }));
vi.mock('@/lib/claude', () => ({ claude: { generateContent: mocks.text, generateStructured: mocks.structured } }));
import { generateQueuedContent, localContentResponseSchema } from './content-inference';

const request = { requestKey: 'fixture', system: 'system', user: 'source', maxTokens: 100 };
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
});
