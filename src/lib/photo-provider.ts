/**
 * Generated-photo provider cascade for the image ladder.
 *
 * The ladder in `carousel-slide.ts` is provider-agnostic: it takes
 * `generatePhoto` as an injected dependency. Three call sites (daily-media,
 * media/carousel, media/thumbnail) each supplied their own one-line closure
 * around `openai.generateImage`, which meant a provider outage had to be fixed
 * in three places. It wasn't — see below.
 *
 * ── Why a cascade rather than one provider ──────────────────────────────────
 * On 2026-07-30 BOTH available providers were dead at the same time:
 *   - Imagen 4 retired: `imagen-4.0-*` 404s "no longer available to new users".
 *   - The OpenAI account hit zero credits: gpt-image-1 returns
 *     "Billing hard limit has been reached".
 * Because the ladder's last rung is a text template that always succeeds, every
 * photoreal image silently became a text card and nothing alerted. This module
 * exists so the recovery path is one edit, and so a single dead provider
 * degrades to the next one instead of to words on a background.
 *
 * Order is deliberate: Gemini first because it is the one that currently works,
 * OpenAI behind it so the ladder self-heals if credits are topped up. A provider
 * that throws is logged and skipped; only an all-providers-failed case throws,
 * which the ladder catches and counts as one failed attempt.
 *
 * Mirrors `PHOTO_PROVIDERS` in the Python renderer (lf_archival.py) so the video
 * and app paths do not drift apart on provider policy.
 */

import { gemini } from '@/lib/gemini';
import { openai } from '@/lib/openai';
import { base64ToArrayBuffer } from '@/lib/utils';

export interface PhotoProvider {
    name: string;
    generate: (prompt: string, aspectRatio?: string) => Promise<ArrayBuffer>;
}

export const PHOTO_PROVIDERS: readonly PhotoProvider[] = [
    {
        name: 'gemini',
        generate: async (prompt, aspectRatio) => {
            const { imageData } = await gemini.generateImage(prompt, { aspectRatio });
            return base64ToArrayBuffer(imageData);
        },
    },
    {
        name: 'openai',
        generate: async (prompt) => {
            const { imageData } = await openai.generateImage(prompt);
            return base64ToArrayBuffer(imageData);
        },
    },
];

/**
 * Render one photo, trying each provider in order.
 *
 * Throws only when every provider failed, with all their messages joined — the
 * ladder surfaces that as the attempt's `detail`, so a total outage is legible
 * in `slide_attempts` instead of looking like a plain audit rejection.
 */
export async function generatePhotoCascade(
    prompt: string,
    options?: { aspectRatio?: string; log?: (m: string) => void },
): Promise<ArrayBuffer> {
    const failures: string[] = [];

    for (const provider of PHOTO_PROVIDERS) {
        try {
            return await provider.generate(prompt, options?.aspectRatio);
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            failures.push(`${provider.name}: ${detail.slice(0, 160)}`);
            options?.log?.(`[image] provider ${provider.name} failed: ${detail.slice(0, 160)}`);
        }
    }

    throw new Error(`all photo providers failed — ${failures.join(' | ')}`);
}
