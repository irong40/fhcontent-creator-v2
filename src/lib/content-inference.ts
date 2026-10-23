import { claude } from '@/lib/claude';
import { getOrEnqueueLocalInference } from '@/lib/local-inference-queue';
import { z } from 'zod';
import { regeneratePieceResponseSchema } from '@/lib/schemas';
import { holdDraft, holdKey, readHeldDraft } from '@/lib/draft-hold';

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

/** Deliberate provider selection. An unavailable local worker never buys a hosted call.
 *  `holdForTopic` (2026-10-22): a hosted draft is held for its topic until the caller releases
 *  it (draft-hold.ts), so a cron run that finds the claim judge unfinished checks the same text
 *  next run instead of buying a new draft. The local provider is durable already. */
export async function generateQueuedContent(request: {
    requestKey: string;
    system: string;
    user: string;
    maxTokens: number;
    schema?: Record<string, unknown>;
    holdForTopic?: string;
}) {
    const { holdForTopic, ...inference } = request;
    const provider = process.env.CONTENT_INFERENCE_PROVIDER ?? 'claude';
    if (provider === 'ollama') {
        return { ...await getOrEnqueueLocalInference(inference), provider: 'ollama' as const };
    }
    if (provider !== 'claude') throw new Error('Invalid CONTENT_INFERENCE_PROVIDER');
    const key = holdForTopic ? holdKey(inference) : null;
    if (key) {
        const held = await readHeldDraft(key);
        if (held) return { ...held, provider: 'claude' as const };
    }
    let draft: { text: string; inputTokens: number; outputTokens: number };
    if (inference.schema) {
        const result = await claude.generateStructured(inference.system, inference.user, {
            name: 'emit_content', description: 'Return the requested content.', inputSchema: inference.schema,
        }, { maxTokens: inference.maxTokens });
        draft = { text: JSON.stringify(result.data), inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    } else {
        const result = await claude.generateContent(inference.system, inference.user, { maxTokens: inference.maxTokens });
        draft = { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    }
    if (key && holdForTopic) await holdDraft(key, holdForTopic, draft);
    return { ...draft, provider: 'claude' as const };
}
