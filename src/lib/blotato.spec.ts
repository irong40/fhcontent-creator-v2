import { describe, it, expect } from 'vitest';
import { buildTarget } from './blotato';

describe('buildTarget', () => {
    it('returns tiktok target with correct defaults', () => {
        const target = buildTarget('tiktok');
        expect(target).toEqual({
            targetType: 'tiktok',
            privacyLevel: 'PUBLIC_TO_EVERYONE',
            disabledComments: false,
            disabledDuet: false,
            disabledStitch: false,
            isBrandedContent: false,
            isYourBrand: true,
            isAiGenerated: true,
            title: undefined,
        });
    });

    it('passes isAiGenerated option to tiktok target', () => {
        const target = buildTarget('tiktok', { isAiGenerated: false });
        expect(target).toMatchObject({ isAiGenerated: false });
    });

    it('passes title option to tiktok target', () => {
        const target = buildTarget('tiktok', { title: 'My Video' });
        expect(target).toMatchObject({ title: 'My Video' });
    });

    it('returns instagram target as reel', () => {
        const target = buildTarget('instagram');
        expect(target).toEqual({
            targetType: 'instagram',
            mediaType: 'reel',
        });
    });

    it('returns youtube target with required fields', () => {
        const target = buildTarget('youtube', { title: 'Test Video' });
        expect(target).toEqual({
            targetType: 'youtube',
            title: 'Test Video',
            privacyStatus: 'public',
            shouldNotifySubscribers: true,
            isMadeForKids: false,
            containsSyntheticMedia: true,
        });
    });

    it('defaults youtube title to "Untitled" when not provided', () => {
        const target = buildTarget('youtube');
        expect(target).toMatchObject({ title: 'Untitled' });
    });

    it('returns twitter target', () => {
        expect(buildTarget('twitter')).toEqual({ targetType: 'twitter' });
    });

    it('returns linkedin target', () => {
        expect(buildTarget('linkedin')).toEqual({ targetType: 'linkedin' });
    });

    it('returns threads target via default branch', () => {
        const target = buildTarget('threads');
        expect(target).toMatchObject({ targetType: 'threads' });
    });

    it('returns bluesky target via default branch', () => {
        const target = buildTarget('bluesky');
        expect(target).toMatchObject({ targetType: 'bluesky' });
    });

    it('handles unknown platform via default branch', () => {
        const target = buildTarget('mastodon' as 'twitter');
        expect(target).toMatchObject({ targetType: 'mastodon' });
    });
});
