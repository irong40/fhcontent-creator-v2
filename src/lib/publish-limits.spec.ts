import { describe, it, expect } from 'vitest';
import {
    PLATFORM_DAILY_CAP,
    isAccountAtDailyCap,
    isTransientPublishError,
} from './publish-limits';

describe('isAccountAtDailyCap', () => {
    it('is false below the cap', () => {
        expect(isAccountAtDailyCap('youtube', PLATFORM_DAILY_CAP.youtube - 1)).toBe(false);
    });

    it('is true at the cap', () => {
        expect(isAccountAtDailyCap('youtube', PLATFORM_DAILY_CAP.youtube)).toBe(true);
    });

    it('is true above the cap', () => {
        expect(isAccountAtDailyCap('tiktok', PLATFORM_DAILY_CAP.tiktok + 5)).toBe(true);
    });

    it('never caps a platform with no configured limit', () => {
        expect(isAccountAtDailyCap('instagram', 1000)).toBe(false);
        expect(isAccountAtDailyCap('twitter', 1000)).toBe(false);
        expect(isAccountAtDailyCap('threads', 1000)).toBe(false);
    });
});

describe('isTransientPublishError', () => {
    it('matches the real YouTube 24h quota message', () => {
        expect(
            isTransientPublishError(
                'You have reached the maximum number of 10 posts for the last 24 hours for this account',
            ),
        ).toBe(true);
    });

    it('matches the real TikTok OpenAPI spam-block message', () => {
        expect(
            isTransientPublishError(
                'Error uploading video to Tiktok: This TikTok creator has made too many posts via OpenAPI in the last 24 hours, so this publishing attempt is blocked to minimize spam.',
            ),
        ).toBe(true);
    });

    it('matches a Blotato 429 rate-limit error', () => {
        expect(
            isTransientPublishError(
                'Blotato API error (429): {"statusCode":429,"message":"Rate limit exceeded, retry in 23 seconds"}',
            ),
        ).toBe(true);
    });

    it('does NOT match a permanent failure', () => {
        expect(isTransientPublishError('Invalid API key')).toBe(false);
        expect(isTransientPublishError('No account configured')).toBe(false);
        expect(isTransientPublishError('body.post.target.title must NOT have more than 100 characters')).toBe(false);
    });

    it('is false for empty / null input', () => {
        expect(isTransientPublishError('')).toBe(false);
        expect(isTransientPublishError(null)).toBe(false);
        expect(isTransientPublishError(undefined)).toBe(false);
    });
});
