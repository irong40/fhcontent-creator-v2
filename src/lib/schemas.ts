import { z } from 'zod';

// --- Request schemas ---

export const topicGenerateSchema = z.object({
    personaId: z.string().uuid(),
    count: z.number().min(1).max(10).default(1),
});

export const contentGenerateSchema = z.object({
    topicId: z.string().uuid(),
});

export const contentUpdateSchema = z.object({
    script: z.string().optional(),
    caption_long: z.string().max(2200).optional(),
    caption_short: z.string().max(280).optional(),
    thumbnail_prompt: z.string().optional(),
    carousel_slides: z.array(z.object({
        slide: z.number(),
        text: z.string(),
        imagePrompt: z.string(),
    })).optional(),
});

// --- Claude response schemas ---

const historicalPointSchema = z.object({
    point: z.number(),
    claim: z.string(),
    source: z.string(),
    year: z.string(),
});

const generatedTopicSchema = z.object({
    title: z.string(),
    hook: z.string(),
    historicalPoints: z.array(historicalPointSchema).length(4),
    thumbnailPrompt: z.string().optional(),
});

export const topicResponseSchema = z.object({
    topics: z.array(generatedTopicSchema).min(1),
});

const generatedPieceSchema = z.object({
    pieceType: z.enum(['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel']),
    script: z.string(),
    captionLong: z.string(),
    captionShort: z.string(),
    thumbnailPrompt: z.string().optional(),
    carouselSlides: z.array(z.object({
        slide: z.number(),
        text: z.string(),
        imagePrompt: z.string(),
    })).optional(),
    musicTrack: z.string().optional(),
});

export const contentResponseSchema = z.object({
    pieces: z.array(generatedPieceSchema).length(6),
});

// --- Media request schemas ---

export const voiceGenerateSchema = z.object({
    contentPieceId: z.string().uuid(),
    voiceId: z.string().min(1),
});

export const videoGenerateSchema = z.object({
    contentPieceId: z.string().uuid(),
    avatarId: z.string().min(1),
    audioUrl: z.string().url(),
});

// --- Inferred types ---

export type TopicGenerateRequest = z.infer<typeof topicGenerateSchema>;
export type ContentGenerateRequest = z.infer<typeof contentGenerateSchema>;
export type ContentUpdateRequest = z.infer<typeof contentUpdateSchema>;
export type GeneratedTopic = z.infer<typeof generatedTopicSchema>;
export type GeneratedPiece = z.infer<typeof generatedPieceSchema>;
export type VoiceGenerateRequest = z.infer<typeof voiceGenerateSchema>;
export type VideoGenerateRequest = z.infer<typeof videoGenerateSchema>;
