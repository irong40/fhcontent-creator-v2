import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCronSecret } from './middleware';

function makeRequest(authHeader?: string): Request {
    const headers = new Headers();
    if (authHeader) headers.set('authorization', authHeader);
    return new Request('http://localhost/api/cron/daily-media', { headers });
}

describe('validateCronSecret', () => {
    beforeEach(() => {
        delete process.env.CRON_SECRET;
    });

    it('allows request when CRON_SECRET is not set (non-production / local dev)', () => {
        // NODE_ENV is 'test' under vitest — the dev-convenience path.
        expect(validateCronSecret(makeRequest())).toBe(true);
    });

    it('fails CLOSED when CRON_SECRET is unset in production (review 2026-07-04)', () => {
        // An env-var mishap (vercel env rm without re-add) must not make
        // every cron endpoint publicly invokable.
        vi.stubEnv('NODE_ENV', 'production');
        try {
            expect(validateCronSecret(makeRequest())).toBe(false);
            expect(validateCronSecret(makeRequest('Bearer anything'))).toBe(false);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('still validates the Bearer secret normally in production when CRON_SECRET is set', () => {
        vi.stubEnv('NODE_ENV', 'production');
        try {
            process.env.CRON_SECRET = 'prod-secret';
            expect(validateCronSecret(makeRequest('Bearer prod-secret'))).toBe(true);
            expect(validateCronSecret(makeRequest('Bearer wrong'))).toBe(false);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('allows request with correct Bearer token', () => {
        process.env.CRON_SECRET = 'test-secret-123';
        expect(validateCronSecret(makeRequest('Bearer test-secret-123'))).toBe(true);
    });

    it('rejects request with wrong Bearer token', () => {
        process.env.CRON_SECRET = 'test-secret-123';
        expect(validateCronSecret(makeRequest('Bearer wrong-secret'))).toBe(false);
    });

    it('rejects request with no authorization header', () => {
        process.env.CRON_SECRET = 'test-secret-123';
        expect(validateCronSecret(makeRequest())).toBe(false);
    });

    it('rejects request with non-Bearer auth scheme', () => {
        process.env.CRON_SECRET = 'test-secret-123';
        expect(validateCronSecret(makeRequest('Basic dXNlcjpwYXNz'))).toBe(false);
    });
});
