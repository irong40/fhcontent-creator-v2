import { describe, it, expect, vi } from 'vitest';
import { sourceCleared, renderRefusal, renderRefusalForTopic, SOURCE_CHECK_REQUIRED } from './source-gate';

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

describe('the render gate', () => {
    function client(piece: Record<string, unknown> | null, cleared: unknown) {
        const rpc = vi.fn(async () => ({ data: cleared, error: null }));
        const from = vi.fn(() => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: piece, error: null }) }) }),
        }));
        return { rpc, from, db: { rpc, from } as unknown as Parameters<typeof renderRefusal>[0] };
    }

    it('lets a cleared topic render', async () => {
        const { db, rpc } = client({ topic_id: 'topic-1', content_channel: null }, true);
        expect(await renderRefusal(db, 'piece-1')).toBeNull();
        expect(rpc).toHaveBeenCalledWith('topic_source_cleared', { p_topic: 'topic-1' });
    });

    it('refuses a topic whose text has not passed, and says nothing was rendered', async () => {
        const { db } = client({ topic_id: 'topic-1', content_channel: null }, false);
        const refusal = await renderRefusal(db, 'piece-1');
        expect(refusal).toContain(SOURCE_CHECK_REQUIRED);
        expect(refusal).toMatch(/Nothing was rendered\.$/);
        expect(await renderRefusalForTopic(db, 'topic-1')).toBe(refusal);
    });

    it('does not gate a lecture piece, and leaves a missing piece to the route', async () => {
        const lecture = client({ topic_id: 'topic-1', content_channel: 'lecture' }, false);
        expect(await renderRefusal(lecture.db, 'piece-1')).toBeNull();
        expect(lecture.rpc).not.toHaveBeenCalled();
        const missing = client(null, false);
        expect(await renderRefusal(missing.db, 'nope')).toBeNull();
        expect(missing.rpc).not.toHaveBeenCalled();
    });
});
