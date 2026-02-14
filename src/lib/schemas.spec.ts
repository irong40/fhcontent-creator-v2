import { describe, it, expect } from 'vitest';
import {
    topicGenerateSchema,
    contentGenerateSchema,
    contentUpdateSchema,
    topicResponseSchema,
    contentResponseSchema,
} from './schemas';

describe('topicGenerateSchema', () => {
    it('accepts valid personaId with default count', () => {
        const result = topicGenerateSchema.parse({
            personaId: '6ac9adfa-27f1-492b-98e1-f5623cb4eda2',
        });
        expect(result.personaId).toBe('6ac9adfa-27f1-492b-98e1-f5623cb4eda2');
        expect(result.count).toBe(1);
    });

    it('accepts explicit count within range', () => {
        const result = topicGenerateSchema.parse({
            personaId: '6ac9adfa-27f1-492b-98e1-f5623cb4eda2',
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
            personaId: '6ac9adfa-27f1-492b-98e1-f5623cb4eda2',
            count: 0,
        });
        expect(result.success).toBe(false);
    });

    it('rejects count above 10', () => {
        const result = topicGenerateSchema.safeParse({
            personaId: '6ac9adfa-27f1-492b-98e1-f5623cb4eda2',
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
            topicId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        });
        expect(result.topicId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
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
