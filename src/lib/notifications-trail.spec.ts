import { beforeEach, describe, expect, it, vi } from 'vitest';
const { insert, sendErrorAlert } = vi.hoisted(() => ({ insert: vi.fn(), sendErrorAlert: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));
vi.mock('@/lib/email', () => ({ sendErrorAlert }));
import { notifyError } from './notifications';

describe('notifyError channel records (no live send: email and database are mocks, webhook unset)', () => {
    beforeEach(() => { vi.clearAllMocks(); delete process.env.N8N_ERROR_WEBHOOK_URL; insert.mockResolvedValue({ error: null }); });
    it('records which channel fired when the webhook is absent', async () => {
        sendErrorAlert.mockResolvedValue(false);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        await notifyError({ source: 's', message: 'm', topicId: 't1', trail: { correlationId: 'c1', topicVersion: 'v1' } });
        expect(fetchSpy).not.toHaveBeenCalled();
        const rows = insert.mock.calls.map(c => c[0]).filter(r => r.stage === 'alert_channel');
        expect(Object.fromEntries(rows.map(r => [r.detail.channel, r.detail.outcome]))).toEqual({ webhook: 'skipped', resend: 'failed', db: 'sent' });
        expect(rows.every(r => r.correlation_id === 'c1')).toBe(true);
    });
    it('writes no trail rows without a trail argument', async () => {
        sendErrorAlert.mockResolvedValue(true);
        await notifyError({ source: 's', message: 'm', topicId: 't1' });
        expect(insert.mock.calls.filter(c => c[0].stage)).toHaveLength(0);
    });
});
