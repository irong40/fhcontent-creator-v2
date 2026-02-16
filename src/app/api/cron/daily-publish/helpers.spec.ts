import { describe, it, expect } from 'vitest';
import { getTargetPlatforms, getMediaUrl, isTextOnlyPlatform } from './helpers';

describe('getTargetPlatforms', () => {
    it('returns tiktok, instagram, youtube for long video', () => {
        expect(getTargetPlatforms('long')).toEqual(['tiktok', 'instagram', 'youtube']);
    });

    it.each([
        'short_1', 'short_2', 'short_3', 'short_4',
    ] as const)('returns 6 platforms for %s', (pieceType) => {
        const result = getTargetPlatforms(pieceType);
        expect(result).toEqual(['tiktok', 'instagram', 'youtube', 'threads', 'twitter', 'bluesky']);
    });

    it('returns only instagram for carousel', () => {
        expect(getTargetPlatforms('carousel')).toEqual(['instagram']);
    });

    it('returns empty array for unknown piece type', () => {
        expect(getTargetPlatforms('nonexistent' as 'long')).toEqual([]);
    });

    it('long videos do not include text-only platforms', () => {
        const platforms = getTargetPlatforms('long');
        expect(platforms).not.toContain('threads');
        expect(platforms).not.toContain('twitter');
        expect(platforms).not.toContain('bluesky');
    });
});

describe('getMediaUrl', () => {
    it('returns carousel_url for carousel piece type', () => {
        const piece = {
            piece_type: 'carousel',
            carousel_url: 'https://example.com/carousel.png',
            video_url: 'https://example.com/video.mp4',
        };
        expect(getMediaUrl(piece)).toBe('https://example.com/carousel.png');
    });

    it('returns video_url for long piece type', () => {
        const piece = {
            piece_type: 'long',
            carousel_url: null,
            video_url: 'https://example.com/video.mp4',
        };
        expect(getMediaUrl(piece)).toBe('https://example.com/video.mp4');
    });

    it('returns video_url for short piece types', () => {
        const piece = {
            piece_type: 'short_1',
            carousel_url: null,
            video_url: 'https://example.com/short.mp4',
        };
        expect(getMediaUrl(piece)).toBe('https://example.com/short.mp4');
    });

    it('returns null when carousel piece has no carousel_url', () => {
        const piece = {
            piece_type: 'carousel',
            carousel_url: null,
            video_url: 'https://example.com/video.mp4',
        };
        expect(getMediaUrl(piece)).toBeNull();
    });

    it('returns null when video piece has no video_url', () => {
        const piece = {
            piece_type: 'long',
            carousel_url: null,
            video_url: null,
        };
        expect(getMediaUrl(piece)).toBeNull();
    });
});

describe('isTextOnlyPlatform', () => {
    it.each([
        'threads', 'twitter', 'bluesky',
    ] as const)('returns true for %s', (platform) => {
        expect(isTextOnlyPlatform(platform)).toBe(true);
    });

    it.each([
        'tiktok', 'instagram', 'youtube', 'linkedin', 'facebook', 'pinterest',
    ] as const)('returns false for %s', (platform) => {
        expect(isTextOnlyPlatform(platform)).toBe(false);
    });
});
