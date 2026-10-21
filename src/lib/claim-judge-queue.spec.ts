import { describe, expect, it, vi } from 'vitest';

const enqueue = vi.hoisted(() => vi.fn());
vi.mock('@/lib/local-inference-queue', () => ({
    getOrEnqueueLocalInference: enqueue,
    LocalInferencePendingError: class LocalInferencePendingError extends Error { constructor() { super('pending'); this.name = 'LocalInferencePendingError'; } },
}));
import { callJudge, judgeClaims } from './claim-check';
import { LocalInferencePendingError } from '@/lib/local-inference-queue';

const points = [{ claim: 'He moved.', quote: 'He moved.' }];

describe('claim judge through the local-inference queue', () => {
    it('queues on qwen3:32b with a key set by the prompt, and never calls 127.0.0.1', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        enqueue.mockResolvedValue({ text: '{"unsupported":[]}', inputTokens: 1, outputTokens: 1 });
        expect(await callJudge('s', 'u')).toBe('{"unsupported":[]}');
        await callJudge('s', 'u');
        await callJudge('s', 'other');
        const [a, b, c] = enqueue.mock.calls.map(x => x[0]);
        expect(a.model).toBe('qwen3:32b');
        expect(a.requestKey).toBe(b.requestKey);
        expect(a.requestKey).not.toBe(c.requestKey);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('asks every piece before it reports a pending job', async () => {
        const call = vi.fn()
            .mockRejectedValueOnce(new LocalInferencePendingError('j'))
            .mockResolvedValue('{"unsupported":[]}');
        await expect(judgeClaims(points, [{ pieceType: 'long', script: 'a' }, { pieceType: 'short_1', script: 'b' }], call)).rejects.toThrow('pending');
        expect(call).toHaveBeenCalledTimes(2);
    });

    it('a real failure wins over a pending job', async () => {
        const call = vi.fn().mockRejectedValueOnce(new LocalInferencePendingError('j')).mockRejectedValueOnce(new Error('exhausted'));
        await expect(judgeClaims(points, [{ pieceType: 'long', script: 'a' }, { pieceType: 'short_1', script: 'b' }], call)).rejects.toThrow('exhausted');
    });
});
