import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks must be declared BEFORE the import of notifications.ts so vitest
// hoists them ahead of the module evaluation.
const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock('@/lib/supabase/server', () => ({
    createAdminClient: () => ({ from: fromMock }),
    createClient: vi.fn(),
}));

vi.mock('@/lib/email', () => ({
    sendErrorAlert: vi.fn().mockResolvedValue(undefined),
}));

import { notifyError } from './notifications';

describe('notifyError', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        delete process.env.N8N_ERROR_WEBHOOK_URL;
        global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
        insertMock.mockClear();
        fromMock.mockClear();
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('skips fetch when N8N_ERROR_WEBHOOK_URL is not set', async () => {
        await notifyError({ source: 'test', message: 'fail' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('sends POST to webhook URL with context', async () => {
        process.env.N8N_ERROR_WEBHOOK_URL = 'https://n8n.example.com/webhook/errors';

        await notifyError({
            source: 'daily-publish',
            message: 'All platform publishes failed',
            topicId: 'topic-123',
            personaName: 'History Unveiled VA',
        });

        expect(global.fetch).toHaveBeenCalledOnce();
        const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe('https://n8n.example.com/webhook/errors');
        expect(options.method).toBe('POST');

        const body = JSON.parse(options.body);
        expect(body.source).toBe('daily-publish');
        expect(body.message).toBe('All platform publishes failed');
        expect(body.topicId).toBe('topic-123');
        expect(body.personaName).toBe('History Unveiled VA');
        expect(body.timestamp).toBeDefined();
    });

    it('does not throw when fetch fails', async () => {
        process.env.N8N_ERROR_WEBHOOK_URL = 'https://n8n.example.com/webhook/errors';
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        await expect(
            notifyError({ source: 'test', message: 'fail' })
        ).resolves.toBeUndefined();
    });

    // --- DB persistence (migration 015) ---

    it('inserts a row into the errors table', async () => {
        await notifyError({
            source: 'daily-media',
            message: 'Lyria failed',
            topicId: 'topic-xyz',
            personaName: 'Dr. Imani Carter',
        });

        expect(fromMock).toHaveBeenCalledWith('errors');
        expect(insertMock).toHaveBeenCalledOnce();

        const insertedRow = insertMock.mock.calls[0][0];
        expect(insertedRow.source).toBe('daily-media');
        expect(insertedRow.message).toBe('Lyria failed');
        expect(insertedRow.topic_id).toBe('topic-xyz');
        expect(insertedRow.persona_name).toBe('Dr. Imani Carter');
        expect(insertedRow.severity).toBe('error'); // default
    });

    it('defaults severity to "error" when not provided', async () => {
        await notifyError({ source: 'x', message: 'y' });
        expect(insertMock.mock.calls[0][0].severity).toBe('error');
    });

    it('honors explicit severity', async () => {
        await notifyError({ source: 'x', message: 'y', severity: 'warning' });
        expect(insertMock.mock.calls[0][0].severity).toBe('warning');
    });

    it('writes null for missing topicId and personaName', async () => {
        await notifyError({ source: 'x', message: 'y' });
        const row = insertMock.mock.calls[0][0];
        expect(row.topic_id).toBeNull();
        expect(row.persona_name).toBeNull();
    });

    it('does not throw when DB insert fails (graceful degradation)', async () => {
        insertMock.mockResolvedValueOnce({ data: null, error: new Error('DB outage') });
        await expect(
            notifyError({ source: 'x', message: 'y' })
        ).resolves.toBeUndefined();
    });

    it('does not throw when DB insert rejects synchronously', async () => {
        insertMock.mockRejectedValueOnce(new Error('Connection refused'));
        await expect(
            notifyError({ source: 'x', message: 'y' })
        ).resolves.toBeUndefined();
    });

    it('still fires webhook even if DB write fails', async () => {
        process.env.N8N_ERROR_WEBHOOK_URL = 'https://n8n.example.com/webhook/errors';
        insertMock.mockRejectedValueOnce(new Error('DB down'));

        await notifyError({ source: 'x', message: 'y' });

        // Webhook fetch must have fired despite DB failure
        expect(global.fetch).toHaveBeenCalledOnce();
    });
});
