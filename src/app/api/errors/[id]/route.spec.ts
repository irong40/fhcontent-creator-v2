import { beforeEach, describe, expect, it, vi } from 'vitest';
const { insert, lastRow, ackRow, errorRow } = vi.hoisted(() => ({ insert: vi.fn(), lastRow: vi.fn(), ackRow: vi.fn(), errorRow: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single: async () => errorRow() }) }) }) }),
    }),
    createAdminClient: () => ({
        from: () => ({
            // Own alert_channel row by error id (lastRow), then the newest acknowledged row for that error (ackRow, default none).
            select: () => {
                let stage = '';
                const q: Record<string, unknown> = { limit: () => ({ maybeSingle: async () => (stage === 'acknowledged' ? (await ackRow()) ?? { data: null, error: null } : lastRow()) }) };
                q.eq = (k: string, v: string) => { if (k === 'stage') stage = v; return q; };
                q.order = () => q;
                return q;
            },
            insert,
        }),
    }),
}));
import { PATCH } from './route';

const call = (body: unknown) => PATCH({ json: async () => body } as never, { params: Promise.resolve({ id: 'e1' }) });

describe('acknowledge writes the HR-7 acknowledged trail row (mocks only)', () => {
    beforeEach(() => { vi.clearAllMocks(); insert.mockResolvedValue({ error: null }); });
    it('writes one acknowledged row with the topic correlation id', async () => {
        errorRow.mockResolvedValue({ data: { id: 'e1', topic_id: 't1' }, error: null });
        lastRow.mockResolvedValue({ data: { correlation_id: 'c1', topic_id: 't1', topic_version: 'v1' } });
        const res = await call({ acknowledged: true });
        expect(res.status).toBe(200);
        expect(insert).toHaveBeenCalledTimes(1);
        expect(insert.mock.calls[0][0]).toMatchObject({ stage: 'acknowledged', correlation_id: 'c1', topic_id: 't1', topic_version: 'v1' });
    });
    it('writes none when the error has no topic or no correlation, or on un-acknowledge', async () => {
        errorRow.mockResolvedValue({ data: { id: 'e1', topic_id: null }, error: null });
        await call({ acknowledged: true });
        errorRow.mockResolvedValue({ data: { id: 'e1', topic_id: 't1' }, error: null });
        lastRow.mockResolvedValue({ data: null });
        await call({ acknowledged: true });
        lastRow.mockResolvedValue({ data: { correlation_id: 'c1', topic_version: 'v1' } });
        await call({ acknowledged: false });
        expect(insert).not.toHaveBeenCalled();
    });
    it('a trail write failure does not fail the acknowledge', async () => {
        errorRow.mockResolvedValue({ data: { id: 'e1', topic_id: 't1' }, error: null });
        lastRow.mockResolvedValue({ data: { correlation_id: 'c1', topic_version: 'v1' } });
        insert.mockRejectedValue(new Error('down'));
        expect((await call({ acknowledged: true })).status).toBe(200);
    });
});
