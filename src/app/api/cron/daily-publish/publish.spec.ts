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
});

describe('publishing platform distribution', () => {
    it('long video targets 3 platforms', () => {
        expect(getTargetPlatforms('long')).toHaveLength(3);
    });

    it('short videos target 6 platforms', () => {
        expect(getTargetPlatforms('short_1')).toHaveLength(6);
        expect(getTargetPlatforms('short_2')).toHaveLength(6);
        expect(getTargetPlatforms('short_3')).toHaveLength(6);
        expect(getTargetPlatforms('short_4')).toHaveLength(6);
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
