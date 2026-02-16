import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notifyError } from './notifications';

describe('notifyError', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        delete process.env.N8N_ERROR_WEBHOOK_URL;
        global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
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
});
