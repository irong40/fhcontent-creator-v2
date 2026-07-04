import { describe, it, expect } from 'vitest';
import { getTargetPlatforms, getMediaUrl, getCarouselUrls, isTextOnlyPlatform } from './helpers';

describe('getCarouselUrls', () => {
    it('returns array from JSON-encoded carousel_url', () => {
        const urls = ['https://a.com/1.png', 'https://a.com/2.png', 'https://a.com/3.png'];
        const piece = { carousel_url: JSON.stringify(urls) };
        expect(getCarouselUrls(piece)).toEqual(urls);
    });

    it('returns single-element array for plain URL', () => {
        const piece = { carousel_url: 'https://a.com/single.png' };
        expect(getCarouselUrls(piece)).toEqual(['https://a.com/single.png']);
    });

    it('returns empty array for null', () => {
        expect(getCarouselUrls({ carousel_url: null })).toEqual([]);
    });

    it('returns empty array for empty string', () => {
        expect(getCarouselUrls({ carousel_url: '' })).toEqual([]);
    });

    // Malformed-row guard (review 2026-07-04): one truncated/hand-edited
    // carousel_url must not throw and crash every hourly tick.
    it('returns empty array (not throw) for truncated JSON', () => {
        expect(getCarouselUrls({ carousel_url: '[https://a.com/1.png' })).toEqual([]);
    });

    it('returns empty array (not throw) for JSON that is not an array', () => {
        expect(getCarouselUrls({ carousel_url: '[]x' })).toEqual([]);
    });

    it('filters non-string entries out of a valid JSON array', () => {
        expect(getCarouselUrls({ carousel_url: '["https://a.com/1.png", 42, null]' })).toEqual(['https://a.com/1.png']);
    });
});

describe('getMediaUrl with JSON carousel', () => {
    it('returns first URL from JSON array for carousel', () => {
        const urls = ['https://a.com/1.png', 'https://a.com/2.png'];
        const piece = {
            piece_type: 'carousel',
            carousel_url: JSON.stringify(urls),
            video_url: null,
        };
        expect(getMediaUrl(piece)).toBe('https://a.com/1.png');
    });

    it('returns plain carousel_url for single URL', () => {
        const piece = {
            piece_type: 'carousel',
            carousel_url: 'https://a.com/slide.png',
            video_url: null,
        };
        expect(getMediaUrl(piece)).toBe('https://a.com/slide.png');
    });

    it('returns null for empty JSON array', () => {
        const piece = {
            piece_type: 'carousel',
            carousel_url: '[]',
            video_url: null,
        };
        expect(getMediaUrl(piece)).toBeNull();
    });

    it('returns null (not throw) for malformed carousel JSON — flows into the "no media URL" skip path', () => {
        const piece = {
            piece_type: 'carousel',
            carousel_url: '[https://a.com/1.png',
            video_url: null,
        };
        expect(getMediaUrl(piece)).toBeNull();
    });
});

describe('publishing platform distribution', () => {
    it('long video targets 3 platforms', () => {
        expect(getTargetPlatforms('long')).toHaveLength(3);
    });

    it('short videos target 5 platforms (bluesky disabled 2026-05-10)', () => {
        expect(getTargetPlatforms('short_1')).toHaveLength(5);
        expect(getTargetPlatforms('short_2')).toHaveLength(5);
        expect(getTargetPlatforms('short_3')).toHaveLength(5);
        expect(getTargetPlatforms('short_4')).toHaveLength(5);
        expect(getTargetPlatforms('short_1')).not.toContain('bluesky');
    });

    it('carousel targets only instagram', () => {
        const platforms = getTargetPlatforms('carousel');
        expect(platforms).toHaveLength(1);
        expect(platforms[0]).toBe('instagram');
    });

    it('text-only platforms are threads, twitter, bluesky', () => {
        expect(isTextOnlyPlatform('threads')).toBe(true);
        expect(isTextOnlyPlatform('twitter')).toBe(true);
        expect(isTextOnlyPlatform('bluesky')).toBe(true);
        expect(isTextOnlyPlatform('tiktok')).toBe(false);
        expect(isTextOnlyPlatform('instagram')).toBe(false);
        expect(isTextOnlyPlatform('youtube')).toBe(false);
    });
});
