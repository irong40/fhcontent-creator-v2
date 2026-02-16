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

    it('allows request when CRON_SECRET is not set', () => {
        expect(validateCronSecret(makeRequest())).toBe(true);
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
