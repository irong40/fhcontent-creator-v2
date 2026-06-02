import { describe, it, expect } from 'vitest';
import { getTargetPlatforms, getConfiguredTargetPlatforms, getMediaUrl, isTextOnlyPlatform, truncateTikTokTitle, truncateYouTubeTitle, capInstagramHashtags, isSlotReady, pieceSlotTime, PIECE_SLOT_OFFSET_HOURS } from './helpers';

describe('getTargetPlatforms', () => {
    it('returns tiktok, instagram, youtube for long video', () => {
        expect(getTargetPlatforms('long')).toEqual(['tiktok', 'instagram', 'youtube']);
    });

    it.each([
        'short_1', 'short_2', 'short_3', 'short_4',
    ] as const)('returns 5 platforms for %s (bluesky disabled 2026-05-10)', (pieceType) => {
        const result = getTargetPlatforms(pieceType);
        expect(result).toEqual(['tiktok', 'instagram', 'youtube', 'threads', 'twitter']);
        expect(result).not.toContain('bluesky');
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

describe('getConfiguredTargetPlatforms', () => {
    it('omits bluesky from short_* even if an account is configured (disabled 2026-05-10)', () => {
        const accounts = {
            tiktok: 'tt_1', instagram: 'ig_1', youtube: 'yt_1',
            threads: 'th_1', twitter: 'tw_1', bluesky: 'bs_1',
        };
        const out = getConfiguredTargetPlatforms('short_1', accounts);
        expect(out).not.toContain('bluesky');
    });

    it('returns empty when accounts is null', () => {
        expect(getConfiguredTargetPlatforms('long', null)).toEqual([]);
    });

    it('returns the 5 expected platforms when all accounts configured', () => {
        const accounts = {
            tiktok: 't', instagram: 'i', youtube: 'y',
            threads: 'th', twitter: 'tw', bluesky: 'bs',
        };
        expect(getConfiguredTargetPlatforms('short_2', accounts)).toEqual(
            ['tiktok', 'instagram', 'youtube', 'threads', 'twitter'],
        );
    });

    it('returns instagram-only carousel when ig account is set', () => {
        expect(getConfiguredTargetPlatforms('carousel', { instagram: 'i' })).toEqual(['instagram']);
    });

    it('returns empty carousel when ig account is missing', () => {
        expect(getConfiguredTargetPlatforms('carousel', { tiktok: 't' })).toEqual([]);
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

describe('truncateTikTokTitle', () => {
    it('returns title unchanged when within limit', () => {
        expect(truncateTikTokTitle('short title')).toBe('short title');
    });

    it('truncates titles longer than 90 chars with ellipsis', () => {
        const long = 'a'.repeat(120);
        const out = truncateTikTokTitle(long);
        expect(out.length).toBe(90);
        expect(out.endsWith('…')).toBe(true);
    });

    it('handles a real-world failing title from Mary Peake topic', () => {
        const title = "Richmond's Secret School: How Mary Peake Built Virginia's First Literacy Network (1847-1862)";
        expect(title.length).toBeGreaterThan(90);
        const out = truncateTikTokTitle(title);
        expect(out.length).toBeLessThanOrEqual(90);
    });
});

describe('truncateYouTubeTitle', () => {
    it('returns title unchanged when within the 100-char limit', () => {
        expect(truncateYouTubeTitle('short title')).toBe('short title');
    });

    it('truncates titles longer than 100 chars with ellipsis', () => {
        const long = 'a'.repeat(150);
        const out = truncateYouTubeTitle(long);
        expect(out.length).toBe(100);
        expect(out.endsWith('…')).toBe(true);
    });

    it('keeps a 100-char title intact (boundary)', () => {
        const exact = 'b'.repeat(100);
        expect(truncateYouTubeTitle(exact)).toBe(exact);
    });

    it('caps a real-world long topic title to <=100 chars', () => {
        const title = 'The Untold Story of Free Black Communities in Antebellum Virginia: Education, Resistance, and Survival 1830-1865';
        expect(title.length).toBeGreaterThan(100);
        const out = truncateYouTubeTitle(title);
        expect(out.length).toBeLessThanOrEqual(100);
    });
});

describe('capInstagramHashtags', () => {
    it('keeps captions with 4 or fewer hashtags untouched', () => {
        const text = 'Great post #a #b #c #d';
        expect(capInstagramHashtags(text)).toBe('Great post #a #b #c #d');
    });

    it('strips hashtags beyond the 4th', () => {
        const text = 'Great post #a #b #c #d #e #f #g';
        const out = capInstagramHashtags(text);
        const matches = out.match(/#[\p{L}\p{N}_]+/gu) ?? [];
        expect(matches.length).toBe(4);
        expect(out).not.toMatch(/#e|#f|#g/);
    });

    it('preserves prose ordering when stripping trailing tags', () => {
        const text = 'Body text here.\n\n#one #two #three #four #five #six #seven #eight';
        const out = capInstagramHashtags(text);
        expect(out).toContain('Body text here.');
        const matches = out.match(/#[\p{L}\p{N}_]+/gu) ?? [];
        expect(matches.length).toBe(4);
    });

    it('caps a real-world 20-hashtag history caption to 4', () => {
        const text = 'Body text.\n\n#history #blackhistory #virginia #virginiahistory #readjusterparty #reconstruction #americanhistory #untoldhistory #education #historyteacher #civilwar #postcivilwar #virginiastate #petersburg #danville #biracial #democracy #historiansoftiktok #learnontiktok #historytok';
        const out = capInstagramHashtags(text);
        const matches = out.match(/#[\p{L}\p{N}_]+/gu) ?? [];
        expect(matches.length).toBe(4);
    });
});

describe('PIECE_SLOT_OFFSET_HOURS', () => {
    it('places long video in evening (peak) slot', () => {
        expect(PIECE_SLOT_OFFSET_HOURS.long).toBe(10);
    });

    it('orders shorts so short_1 fires earliest', () => {
        const offsets = [
            PIECE_SLOT_OFFSET_HOURS.short_1,
            PIECE_SLOT_OFFSET_HOURS.short_2,
            PIECE_SLOT_OFFSET_HOURS.short_3,
            PIECE_SLOT_OFFSET_HOURS.short_4,
        ];
        // short_1 first, short_4 last among shorts
        expect(offsets[0]).toBeLessThan(offsets[1]);
        expect(offsets[1]).toBeLessThan(offsets[2]);
        expect(offsets[2]).toBeLessThan(offsets[3]);
    });

    it('puts carousel between shorts (3 PM ET-ish)', () => {
        expect(PIECE_SLOT_OFFSET_HOURS.carousel).toBe(6);
    });
});

describe('pieceSlotTime', () => {
    it('returns null when topicPublishAt is null', () => {
        expect(pieceSlotTime('long', null)).toBeNull();
    });

    it('adds the correct offset for long (10h)', () => {
        const base = '2026-05-12T13:00:00Z';
        const out = pieceSlotTime('long', base);
        expect(out?.toISOString()).toBe('2026-05-12T23:00:00.000Z');
    });

    it('returns base time for short_1 (offset 0)', () => {
        const base = '2026-05-12T13:00:00Z';
        const out = pieceSlotTime('short_1', base);
        expect(out?.toISOString()).toBe('2026-05-12T13:00:00.000Z');
    });
});

describe('isSlotReady', () => {
    it('returns true when slot has passed', () => {
        const base = '2026-05-12T13:00:00Z'; // long → 23:00
        const now = new Date('2026-05-13T00:00:00Z');
        expect(isSlotReady('long', base, now)).toBe(true);
    });

    it('returns false when slot is in the future', () => {
        const base = '2026-05-12T13:00:00Z'; // long → 23:00
        const now = new Date('2026-05-12T15:00:00Z');
        expect(isSlotReady('long', base, now)).toBe(false);
    });

    it('returns true at exact slot time (>=)', () => {
        const base = '2026-05-12T13:00:00Z';
        const now = new Date('2026-05-12T23:00:00Z');
        expect(isSlotReady('long', base, now)).toBe(true);
    });

    it('returns true when topicPublishAt is null (legacy fallback)', () => {
        expect(isSlotReady('long', null)).toBe(true);
    });

    it('short_1 ready at base time, long not yet', () => {
        const base = '2026-05-12T13:00:00Z';
        const now = new Date('2026-05-12T13:00:00Z');
        expect(isSlotReady('short_1', base, now)).toBe(true);
        expect(isSlotReady('short_2', base, now)).toBe(false);
        expect(isSlotReady('long', base, now)).toBe(false);
    });
});
