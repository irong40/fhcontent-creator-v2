import { describe, it, expect } from 'vitest';
import {
    topicGenerateSchema,
    contentGenerateSchema,
    contentUpdateSchema,
    topicResponseSchema,
    contentResponseSchema,
    voiceGenerateSchema,
    videoGenerateSchema,
    thumbnailGenerateSchema,
    carouselGenerateSchema,
    musicGenerateSchema,
    approveTopicSchema,
    scheduleTopicSchema,
    regenerateSchema,
    publishTopicSchema,
    regeneratePieceResponseSchema,
    remixRequestSchema,
    remixScriptResponseSchema,
    remixCaptionLongResponseSchema,
    remixCaptionShortResponseSchema,
    remixThumbnailPromptResponseSchema,
    remixCarouselSlidesResponseSchema,
} from './schemas';
import type { RegeneratePieceResponse } from './schemas';

const VALID_UUID = '6ac9adfa-27f1-492b-98e1-f5623cb4eda2';

describe('topicGenerateSchema', () => {
    it('accepts valid personaId with default count', () => {
        const result = topicGenerateSchema.parse({
            personaId: VALID_UUID,
        });
        expect(result.personaId).toBe(VALID_UUID);
        expect(result.count).toBe(1);
    });

    it('accepts explicit count within range', () => {
        const result = topicGenerateSchema.parse({
            personaId: VALID_UUID,
            count: 5,
        });
        expect(result.count).toBe(5);
    });

    it('rejects non-UUID personaId', () => {
        const result = topicGenerateSchema.safeParse({ personaId: 'not-a-uuid' });
        expect(result.success).toBe(false);
    });

    it('rejects count below 1', () => {
        const result = topicGenerateSchema.safeParse({
            personaId: VALID_UUID,
            count: 0,
        });
        expect(result.success).toBe(false);
    });

    it('rejects count above 10', () => {
        const result = topicGenerateSchema.safeParse({
            personaId: VALID_UUID,
            count: 11,
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing personaId', () => {
        const result = topicGenerateSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('contentGenerateSchema', () => {
    it('accepts valid UUID topicId', () => {
        const result = contentGenerateSchema.parse({
            topicId: VALID_UUID,
        });
        expect(result.topicId).toBe(VALID_UUID);
    });

    it('rejects non-UUID topicId', () => {
        const result = contentGenerateSchema.safeParse({ topicId: 'abc123' });
        expect(result.success).toBe(false);
    });
});

describe('contentUpdateSchema', () => {
    it('accepts partial updates', () => {
        const result = contentUpdateSchema.parse({ script: 'New script text' });
        expect(result.script).toBe('New script text');
        expect(result.caption_long).toBeUndefined();
    });

    it('accepts empty object', () => {
        const result = contentUpdateSchema.parse({});
        expect(result).toEqual({});
    });

    it('rejects caption_long over 2200 chars', () => {
        const result = contentUpdateSchema.safeParse({
            caption_long: 'x'.repeat(2201),
        });
        expect(result.success).toBe(false);
    });

    it('rejects caption_short over 280 chars', () => {
        const result = contentUpdateSchema.safeParse({
            caption_short: 'x'.repeat(281),
        });
        expect(result.success).toBe(false);
    });

    it('accepts valid carousel_slides', () => {
        const result = contentUpdateSchema.parse({
            carousel_slides: [
                { slide: 1, text: 'Hook', imagePrompt: 'A dramatic scene' },
                { slide: 2, text: 'Point 1', imagePrompt: 'Historic building' },
            ],
        });
        expect(result.carousel_slides).toHaveLength(2);
    });

    it('rejects carousel_slides with missing fields', () => {
        const result = contentUpdateSchema.safeParse({
            carousel_slides: [{ slide: 1, text: 'Hook' }], // missing imagePrompt
        });
        expect(result.success).toBe(false);
    });
});

describe('topicResponseSchema', () => {
    const validTopic = {
        title: "Gabriel's Rebellion of 1800",
        hook: 'Did you know the largest planned rebellion...',
        historicalPoints: [
            { point: 1, claim: 'Gabriel was enslaved', source: 'Court records', year: '1799' },
            { point: 2, claim: 'Over 1000 rebels', source: 'Archives', year: '1800' },
            { point: 3, claim: 'Betrayed by informants', source: 'Trial records', year: '1800' },
            { point: 4, claim: 'Gabriel was executed', source: 'State records', year: '1800' },
        ],
    };

    it('accepts valid topic response', () => {
        const result = topicResponseSchema.parse({ topics: [validTopic] });
        expect(result.topics).toHaveLength(1);
        expect(result.topics[0].title).toBe("Gabriel's Rebellion of 1800");
    });

    it('accepts topic with optional thumbnailPrompt', () => {
        const result = topicResponseSchema.parse({
            topics: [{ ...validTopic, thumbnailPrompt: 'A dramatic portrait' }],
        });
        expect(result.topics[0].thumbnailPrompt).toBe('A dramatic portrait');
    });

    it('rejects empty topics array', () => {
        const result = topicResponseSchema.safeParse({ topics: [] });
        expect(result.success).toBe(false);
    });

    it('rejects topic with fewer than 4 historical points', () => {
        const result = topicResponseSchema.safeParse({
            topics: [{
                ...validTopic,
                historicalPoints: validTopic.historicalPoints.slice(0, 3),
            }],
        });
        expect(result.success).toBe(false);
    });

    it('rejects topic with more than 4 historical points', () => {
        const result = topicResponseSchema.safeParse({
            topics: [{
                ...validTopic,
                historicalPoints: [
                    ...validTopic.historicalPoints,
                    { point: 5, claim: 'Extra', source: 'Source', year: '1801' },
                ],
            }],
        });
        expect(result.success).toBe(false);
    });

    it('rejects topic missing required fields', () => {
        const result = topicResponseSchema.safeParse({
            topics: [{ title: 'Test' }],
        });
        expect(result.success).toBe(false);
    });
});

describe('contentResponseSchema', () => {
    const makePiece = (pieceType: string) => ({
        pieceType,
        script: 'Test script',
        captionLong: 'Long caption with hashtags',
        captionShort: 'Short caption',
        thumbnailPrompt: 'A vivid image',
    });

    const validPieces = [
        makePiece('long'),
        makePiece('short_1'),
        makePiece('short_2'),
        makePiece('short_3'),
        makePiece('short_4'),
        {
            ...makePiece('carousel'),
            carouselSlides: [
                { slide: 1, text: 'Hook', imagePrompt: 'Scene 1' },
                { slide: 2, text: 'Point 1', imagePrompt: 'Scene 2' },
            ],
            musicTrack: 'inspirational',
        },
    ];

    it('accepts valid 6-piece response', () => {
        const result = contentResponseSchema.parse({ pieces: validPieces });
        expect(result.pieces).toHaveLength(6);
    });

    it('rejects fewer than 6 pieces', () => {
        const result = contentResponseSchema.safeParse({
            pieces: validPieces.slice(0, 5),
        });
        expect(result.success).toBe(false);
    });

    it('rejects more than 6 pieces', () => {
        const result = contentResponseSchema.safeParse({
            pieces: [...validPieces, makePiece('long')],
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid pieceType', () => {
        const result = contentResponseSchema.safeParse({
            pieces: [
                makePiece('invalid_type'),
                ...validPieces.slice(1),
            ],
        });
        expect(result.success).toBe(false);
    });

    it('rejects piece missing script', () => {
        const result = contentResponseSchema.safeParse({
            pieces: [
                { pieceType: 'long', captionLong: 'x', captionShort: 'x' },
                ...validPieces.slice(1),
            ],
        });
        expect(result.success).toBe(false);
    });
});

describe('voiceGenerateSchema', () => {


    it('accepts valid contentPieceId and voiceId', () => {
        const result = voiceGenerateSchema.parse({
            contentPieceId: VALID_UUID,
            voiceId: 'pNInz6obpgDQGcFmaJgB',
        });
        expect(result.contentPieceId).toBe(VALID_UUID);
        expect(result.voiceId).toBe('pNInz6obpgDQGcFmaJgB');
    });

    it('rejects non-UUID contentPieceId', () => {
        const result = voiceGenerateSchema.safeParse({
            contentPieceId: 'not-uuid',
            voiceId: 'pNInz6obpgDQGcFmaJgB',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty voiceId', () => {
        const result = voiceGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
            voiceId: '',
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing voiceId', () => {
        const result = voiceGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
        });
        expect(result.success).toBe(false);
    });
});

describe('videoGenerateSchema', () => {


    it('accepts valid contentPieceId, avatarId, and audioUrl', () => {
        const result = videoGenerateSchema.parse({
            contentPieceId: VALID_UUID,
            avatarId: 'avatar_abc123',
            audioUrl: 'https://storage.supabase.co/media/audio.mp3',
        });
        expect(result.contentPieceId).toBe(VALID_UUID);
        expect(result.avatarId).toBe('avatar_abc123');
        expect(result.audioUrl).toBe('https://storage.supabase.co/media/audio.mp3');
    });

    it('rejects non-UUID contentPieceId', () => {
        const result = videoGenerateSchema.safeParse({
            contentPieceId: 'bad',
            avatarId: 'avatar_abc123',
            audioUrl: 'https://example.com/audio.mp3',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid audioUrl', () => {
        const result = videoGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
            avatarId: 'avatar_abc123',
            audioUrl: 'not-a-url',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty avatarId', () => {
        const result = videoGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
            avatarId: '',
            audioUrl: 'https://example.com/audio.mp3',
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing fields', () => {
        const result = videoGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
        });
        expect(result.success).toBe(false);
    });
});

describe('thumbnailGenerateSchema', () => {


    it('accepts valid contentPieceId', () => {
        const result = thumbnailGenerateSchema.parse({ contentPieceId: VALID_UUID });
        expect(result.contentPieceId).toBe(VALID_UUID);
    });

    it('rejects non-UUID contentPieceId', () => {
        const result = thumbnailGenerateSchema.safeParse({ contentPieceId: 'not-uuid' });
        expect(result.success).toBe(false);
    });

    it('rejects missing contentPieceId', () => {
        const result = thumbnailGenerateSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('carouselGenerateSchema', () => {


    it('accepts valid contentPieceId and templateId', () => {
        const result = carouselGenerateSchema.parse({
            contentPieceId: VALID_UUID,
            templateId: 'tmpl_abc123',
        });
        expect(result.contentPieceId).toBe(VALID_UUID);
        expect(result.templateId).toBe('tmpl_abc123');
    });

    it('accepts optional brandKitId', () => {
        const result = carouselGenerateSchema.parse({
            contentPieceId: VALID_UUID,
            templateId: 'tmpl_abc123',
            brandKitId: 'bk_xyz',
        });
        expect(result.brandKitId).toBe('bk_xyz');
    });

    it('rejects non-UUID contentPieceId', () => {
        const result = carouselGenerateSchema.safeParse({
            contentPieceId: 'bad',
            templateId: 'tmpl_abc123',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty templateId', () => {
        const result = carouselGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
            templateId: '',
        });
        expect(result.success).toBe(false);
    });

    it('rejects missing templateId', () => {
        const result = carouselGenerateSchema.safeParse({
            contentPieceId: VALID_UUID,
        });
        expect(result.success).toBe(false);
    });
});

describe('musicGenerateSchema', () => {


    it('accepts valid contentPieceId', () => {
        const result = musicGenerateSchema.parse({ contentPieceId: VALID_UUID });
        expect(result.contentPieceId).toBe(VALID_UUID);
    });

    it('accepts optional mood', () => {
        const result = musicGenerateSchema.parse({
            contentPieceId: VALID_UUID,
            mood: 'inspirational',
        });
        expect(result.mood).toBe('inspirational');
    });

    it('rejects non-UUID contentPieceId', () => {
        const result = musicGenerateSchema.safeParse({ contentPieceId: 'bad' });
        expect(result.success).toBe(false);
    });

    it('rejects missing contentPieceId', () => {
        const result = musicGenerateSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('accepts empty string mood', () => {
        const result = musicGenerateSchema.parse({
            contentPieceId: VALID_UUID,
            mood: '',
        });
        expect(result.mood).toBe('');
    });
});

describe('approveTopicSchema', () => {
    it('accepts empty object', () => {
        const result = approveTopicSchema.parse({});
        expect(result.publishDate).toBeUndefined();
        expect(result.publishTime).toBeUndefined();
    });

    it('accepts optional publishDate and publishTime', () => {
        const result = approveTopicSchema.parse({
            publishDate: '2026-03-01',
            publishTime: '09:00',
        });
        expect(result.publishDate).toBe('2026-03-01');
        expect(result.publishTime).toBe('09:00');
    });

    it('accepts publishDate without publishTime', () => {
        const result = approveTopicSchema.parse({ publishDate: '2026-03-01' });
        expect(result.publishDate).toBe('2026-03-01');
    });
});

describe('scheduleTopicSchema', () => {
    it('accepts valid date with default time', () => {
        const result = scheduleTopicSchema.parse({ publishDate: '2026-03-01' });
        expect(result.publishDate).toBe('2026-03-01');
        expect(result.publishTime).toBe('09:00');
    });

    it('accepts explicit publishTime', () => {
        const result = scheduleTopicSchema.parse({
            publishDate: '2026-03-01',
            publishTime: '14:30',
        });
        expect(result.publishTime).toBe('14:30');
    });

    it('rejects empty publishDate', () => {
        const result = scheduleTopicSchema.safeParse({ publishDate: '' });
        expect(result.success).toBe(false);
    });

    it('rejects missing publishDate', () => {
        const result = scheduleTopicSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe('regenerateSchema', () => {
    it('accepts empty object', () => {
        const result = regenerateSchema.parse({});
        expect(result).toEqual({});
    });
});

describe('publishTopicSchema', () => {
    it('accepts empty object with default force=false', () => {
        const result = publishTopicSchema.parse({});
        expect(result.force).toBe(false);
    });

    it('accepts force: true', () => {
        const result = publishTopicSchema.parse({ force: true });
        expect(result.force).toBe(true);
    });

    it('rejects non-boolean force', () => {
        const result = publishTopicSchema.safeParse({ force: 'yes' });
        expect(result.success).toBe(false);
    });
});

describe('regeneratePieceResponseSchema', () => {
    const validPiece = {
        pieceType: 'long',
        script: 'Test script about history',
        captionLong: 'A long caption with hashtags #history',
        captionShort: 'Short caption',
        thumbnailPrompt: 'A vivid historical scene',
    };

    it('accepts a valid piece', () => {
        const result = regeneratePieceResponseSchema.parse(validPiece);
        expect(result.script).toBe('Test script about history');
        expect(result.pieceType).toBe('long');
    });

    it('rejects piece missing script', () => {
        const { script, ...noScript } = validPiece;
        const result = regeneratePieceResponseSchema.safeParse(noScript);
        expect(result.success).toBe(false);
    });

    it('rejects piece missing captions', () => {
        const { captionLong, captionShort, ...noCaptions } = validPiece;
        const result = regeneratePieceResponseSchema.safeParse(noCaptions);
        expect(result.success).toBe(false);
    });

    it('accepts piece without optional thumbnailPrompt', () => {
        const { thumbnailPrompt, ...noThumb } = validPiece;
        const result = regeneratePieceResponseSchema.parse(noThumb);
        expect(result.thumbnailPrompt).toBeUndefined();
    });

    it('accepts carousel piece with slides', () => {
        const carousel = {
            ...validPiece,
            pieceType: 'carousel',
            carouselSlides: [
                { slide: 1, text: 'Hook', imagePrompt: 'Scene 1' },
                { slide: 2, text: 'Point 1', imagePrompt: 'Scene 2' },
            ],
            musicTrack: 'inspirational',
        };
        const result = regeneratePieceResponseSchema.parse(carousel);
        expect(result.carouselSlides).toHaveLength(2);
        expect(result.musicTrack).toBe('inspirational');
    });

    it('exports RegeneratePieceResponse type', () => {
        const piece: RegeneratePieceResponse = validPiece as RegeneratePieceResponse;
        expect(piece.script).toBe('Test script about history');
    });
});

describe('remixRequestSchema', () => {
    it.each([
        'script', 'caption_long', 'caption_short', 'thumbnail_prompt', 'carousel_slides',
    ])('accepts valid field "%s"', (field) => {
        const result = remixRequestSchema.parse({ field });
        expect(result.field).toBe(field);
    });

    it('rejects invalid field name', () => {
        const result = remixRequestSchema.safeParse({ field: 'title' });
        expect(result.success).toBe(false);
    });

    it('rejects missing field', () => {
        const result = remixRequestSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('rejects empty string field', () => {
        const result = remixRequestSchema.safeParse({ field: '' });
        expect(result.success).toBe(false);
    });
});

describe('remix response schemas', () => {
    it('remixScriptResponseSchema accepts valid script', () => {
        const result = remixScriptResponseSchema.parse({ script: 'New script text' });
        expect(result.script).toBe('New script text');
    });

    it('remixScriptResponseSchema rejects missing script', () => {
        expect(remixScriptResponseSchema.safeParse({}).success).toBe(false);
    });

    it('remixCaptionLongResponseSchema accepts valid captionLong', () => {
        const result = remixCaptionLongResponseSchema.parse({ captionLong: 'A long caption' });
        expect(result.captionLong).toBe('A long caption');
    });

    it('remixCaptionShortResponseSchema accepts valid captionShort', () => {
        const result = remixCaptionShortResponseSchema.parse({ captionShort: 'Short one' });
        expect(result.captionShort).toBe('Short one');
    });

    it('remixThumbnailPromptResponseSchema accepts valid thumbnailPrompt', () => {
        const result = remixThumbnailPromptResponseSchema.parse({ thumbnailPrompt: 'A vivid scene' });
        expect(result.thumbnailPrompt).toBe('A vivid scene');
    });

    it('remixCarouselSlidesResponseSchema accepts valid slides', () => {
        const result = remixCarouselSlidesResponseSchema.parse({
            carouselSlides: [
                { slide: 1, text: 'Hook', imagePrompt: 'Scene 1' },
                { slide: 2, text: 'Point', imagePrompt: 'Scene 2' },
            ],
        });
        expect(result.carouselSlides).toHaveLength(2);
    });

    it('remixCarouselSlidesResponseSchema rejects slides missing imagePrompt', () => {
        const result = remixCarouselSlidesResponseSchema.safeParse({
            carouselSlides: [{ slide: 1, text: 'Hook' }],
        });
        expect(result.success).toBe(false);
    });
});
