import { describe, it, expect, vi } from 'vitest';
import { sourceCleared, SOURCE_CHECK_REQUIRED } from './source-gate';

function db(answer: { data: unknown; error: { message: string } | null }) {
    const rpc = vi.fn(async () => answer);
    return { rpc, client: { rpc } as unknown as Parameters<typeof sourceCleared>[0] };
}

describe('sourceCleared', () => {
    it('asks the database function about this topic', async () => {
        const { rpc, client } = db({ data: true, error: null });
        expect(await sourceCleared(client, 'topic-1')).toEqual({ cleared: true });
        expect(rpc).toHaveBeenCalledWith('topic_source_cleared', { p_topic: 'topic-1' });
    });

    it.each([false, null, undefined, 'true', 1, 0, {}])('does not clear on %p', async (data) => {
        const result = await sourceCleared(db({ data, error: null }).client, 'topic-1');
        expect(result.cleared).toBe(false);
        expect(result).toMatchObject({ reason: expect.stringContaining(SOURCE_CHECK_REQUIRED) });
    });

    it('fails closed when the question cannot be asked', async () => {
        const result = await sourceCleared(db({ data: true, error: { message: 'function not found' } }).client, 'topic-1');
        expect(result.cleared).toBe(false);
        expect(result).toMatchObject({ reason: expect.stringContaining('function not found') });
    });
});
