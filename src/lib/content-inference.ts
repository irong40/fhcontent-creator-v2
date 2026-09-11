import { claude } from '@/lib/claude';
import { getOrEnqueueLocalInference } from '@/lib/local-inference-queue';
import { z } from 'zod';
import { regeneratePieceResponseSchema } from '@/lib/schemas';

// Bounded strings prevent local grammar generation from endlessly repeating a
// framing instruction inside an image prompt. Existing business shape is kept.
export const localContentResponseSchema = z.object({ pieces: z.array(regeneratePieceResponseSchema.extend({
    script: z.string().min(1).max(6500),
    captionLong: z.string().min(1).max(2200),
    captionShort: z.string().min(1).max(280),
    thumbnailPrompt: z.string().max(700).optional(),
    musicTrack: z.string().max(60).optional(),
    carouselSlides: z.array(z.object({slide:z.number().int().min(1).max(10),text:z.string().min(1).max(500),imagePrompt:z.string().min(1).max(700)})).min(8).max(10).optional(),
})).length(6) });

/** Deliberate provider selection. An unavailable local worker never buys a hosted call. */
export async function generateQueuedContent(request: {
    requestKey: string;
    system: string;
    user: string;
    maxTokens: number;
    schema?: Record<string, unknown>;
}) {
    const provider = process.env.CONTENT_INFERENCE_PROVIDER ?? 'claude';
    if (provider === 'ollama') {
        return { ...await getOrEnqueueLocalInference(request), provider: 'ollama' as const };
    }
    if (provider !== 'claude') throw new Error('Invalid CONTENT_INFERENCE_PROVIDER');
    if (request.schema) {
        const result = await claude.generateStructured(request.system, request.user, {
            name: 'emit_content', description: 'Return the requested content.', inputSchema: request.schema,
        }, { maxTokens: request.maxTokens });
        return { text: JSON.stringify(result.data), inputTokens: result.inputTokens, outputTokens: result.outputTokens, provider: 'claude' as const };
    }
    return { ...await claude.generateContent(request.system, request.user, { maxTokens: request.maxTokens }), provider: 'claude' as const };
}
