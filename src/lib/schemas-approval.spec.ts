import { describe, it, expect } from 'vitest';
import {
    approveTopicSchema,
    scheduleTopicSchema,
    publishTopicSchema,
    musicGenerateSchema,
    voiceGenerateSchema,
    videoGenerateSchema,
    thumbnailGenerateSchema,
    carouselGenerateSchema,
} from './schemas';

describe('approveTopicSchema', () => {
    it('accepts empty object', () => {
        expect(approveTopicSchema.parse({})).toEqual({});
    });

    it('accepts optional publishDate', () => {
        const result = approveTopicSchema.parse({ publishDate: '2026-03-01' });
        expect(result.publishDate).toBe('2026-03-01');
    });
});

describe('scheduleTopicSchema', () => {
    it('requires publishDate', () => {
        expect(() => scheduleTopicSchema.parse({})).toThrow();
    });

    it('defaults publishTime to 09:00', () => {
        const result = scheduleTopicSchema.parse({ publishDate: '2026-03-01' });
        expect(result.publishTime).toBe('09:00');
    });

    it('accepts custom publishTime', () => {
        const result = scheduleTopicSchema.parse({ publishDate: '2026-03-01', publishTime: '14:30' });
        expect(result.publishTime).toBe('14:30');
    });

    it('rejects empty publishDate', () => {
        expect(() => scheduleTopicSchema.parse({ publishDate: '' })).toThrow();
    });
});

describe('publishTopicSchema', () => {
    it('defaults force to false', () => {
        const result = publishTopicSchema.parse({});
        expect(result.force).toBe(false);
    });

    it('accepts force: true', () => {
        const result = publishTopicSchema.parse({ force: true });
        expect(result.force).toBe(true);
    });
});

describe('media generation schemas', () => {
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';

    describe('musicGenerateSchema', () => {
        it('requires contentPieceId', () => {
            expect(() => musicGenerateSchema.parse({})).toThrow();
        });

        it('accepts optional mood', () => {
            const result = musicGenerateSchema.parse({ contentPieceId: validUuid, mood: 'upbeat' });
            expect(result.mood).toBe('upbeat');
        });

        it('accepts without mood', () => {
            const result = musicGenerateSchema.parse({ contentPieceId: validUuid });
            expect(result.mood).toBeUndefined();
        });
    });

    describe('voiceGenerateSchema', () => {
        it('requires contentPieceId and voiceId', () => {
            expect(() => voiceGenerateSchema.parse({ contentPieceId: validUuid })).toThrow();
            expect(() => voiceGenerateSchema.parse({ voiceId: 'abc' })).toThrow();
        });

        it('accepts valid input', () => {
            const result = voiceGenerateSchema.parse({ contentPieceId: validUuid, voiceId: 'abc123' });
            expect(result.voiceId).toBe('abc123');
        });
    });

    describe('videoGenerateSchema', () => {
        it('requires all fields', () => {
            expect(() => videoGenerateSchema.parse({})).toThrow();
        });

        it('validates audioUrl is a URL', () => {
            expect(() => videoGenerateSchema.parse({
                contentPieceId: validUuid,
                avatarId: 'avatar_1',
                audioUrl: 'not-a-url',
            })).toThrow();
        });

        it('accepts valid input', () => {
            const result = videoGenerateSchema.parse({
                contentPieceId: validUuid,
                avatarId: 'avatar_1',
                audioUrl: 'https://storage.example.com/audio.mp3',
            });
            expect(result.avatarId).toBe('avatar_1');
        });
    });

    describe('thumbnailGenerateSchema', () => {
        it('requires contentPieceId', () => {
            expect(() => thumbnailGenerateSchema.parse({})).toThrow();
        });

        it('rejects invalid UUID', () => {
            expect(() => thumbnailGenerateSchema.parse({ contentPieceId: 'not-a-uuid' })).toThrow();
        });
    });

    describe('carouselGenerateSchema', () => {
        it('requires contentPieceId (templateId is optional)', () => {
            expect(() => carouselGenerateSchema.parse({})).toThrow();
            const result = carouselGenerateSchema.parse({ contentPieceId: validUuid });
            expect(result.contentPieceId).toBe(validUuid);
        });

        it('accepts optional brandKitId', () => {
            const result = carouselGenerateSchema.parse({
                contentPieceId: validUuid,
                templateId: 'template_abc',
                brandKitId: 'brand_123',
            });
            expect(result.brandKitId).toBe('brand_123');
        });
    });
});
