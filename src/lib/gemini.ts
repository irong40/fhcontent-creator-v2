/**
 * Gemini (Google AI) API Client
 * Alternative LLM for content generation
 */

import { GoogleGenAI, type LiveMusicServerMessage } from '@google/genai';
import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Convert interleaved stereo PCM Int16 samples to MP3.
 * Lyria outputs 48 kHz stereo PCM.
 */
export function pcmToMp3(pcmData: Int16Array): ArrayBuffer {
    const sampleRate = 48000;
    const channels = 2;
    const kbps = 192;
    const encoder = new Mp3Encoder(channels, sampleRate, kbps);
    const mp3Chunks: Uint8Array[] = [];

    // De-interleave stereo PCM into left/right channels
    const samplesPerChannel = pcmData.length / channels;
    const left = new Int16Array(samplesPerChannel);
    const right = new Int16Array(samplesPerChannel);
    for (let i = 0; i < samplesPerChannel; i++) {
        left[i] = pcmData[i * 2];
        right[i] = pcmData[i * 2 + 1];
    }

    // Encode in 1152-sample blocks (MP3 frame size)
    const blockSize = 1152;
    for (let i = 0; i < samplesPerChannel; i += blockSize) {
        const leftChunk = left.subarray(i, Math.min(i + blockSize, samplesPerChannel));
        const rightChunk = right.subarray(i, Math.min(i + blockSize, samplesPerChannel));
        const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) mp3Chunks.push(mp3buf);
    }

    const flush = encoder.flush();
    if (flush.length > 0) mp3Chunks.push(flush);

    // Concatenate all MP3 chunks into a single ArrayBuffer
    const totalLength = mp3Chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of mp3Chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result.buffer;
}

class GeminiClient {
    private readonly baseUrl = 'https://generativelanguage.googleapis.com';
    private readonly apiKey: string;

    constructor() {
        this.apiKey = (process.env.GEMINI_API_KEY || '').trim();
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            const response = await fetch(`${this.baseUrl}/v1beta/models?key=${this.apiKey}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini API error (${response.status}): ${errorText}`);
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    async generateContent(prompt: string, options?: {
        model?: string;
        maxOutputTokens?: number;
    }): Promise<{ text: string }> {
        const model = options?.model || 'gemini-2.0-flash';
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: options?.maxOutputTokens || 4096,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { text };
    }

    /** Generate a photographic image with `gemini-3.1-flash-image` via the
     *  `:generateContent` endpoint.
     *
     *  This used to call Imagen 4 (`imagen-4.0-generate-001`) via `:predict`.
     *  That whole family is retired: every id 404s with "no longer available to
     *  new users", re-confirmed 2026-07-30 against both keys we hold. Because
     *  rung 2 (gpt-image-1) is simultaneously dead on a zero-credit OpenAI
     *  account, the carousel ladder had no working image rung at all and every
     *  slide fell through to the satori text template — the all-words format
     *  the photo-first work exists to retire.
     *
     *  3.1-flash over 3-pro: on the same prompt, pro renders garbled
     *  pseudo-lettering into signage and headstones while flash leaves them
     *  honestly blurred. Invented text inside something a viewer reads as a
     *  photograph is the worse failure for a history brand. Flash is cheaper too.
     *
     *  Request shape: { contents: [{ parts: [{ text }] }],
     *                   generationConfig: { responseModalities, imageConfig } }
     *  Response shape: candidates[].content.parts[].inlineData.data (base64).
     *  The inline key is camelCase or snake_case depending on model, so both
     *  are checked.
     *
     *  Returns base64 JPEG (Imagen returned PNG). Callers that re-encode via
     *  sharp are unaffected; any caller writing bytes straight to a `.png` path
     *  is relying on content sniffing.
     *
     *  Throws with the actual API body so the caller's alert shows the real
     *  reason (auth / content-policy / quota) rather than a generic failure. */
    async generateImage(prompt: string, options?: {
        aspectRatio?: string;
        model?: string;
    }): Promise<{ imageData: string }> {
        const model = options?.model || 'gemini-3.1-flash-image';
        const response = await fetch(
            `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ['IMAGE'],
                        imageConfig: { aspectRatio: options?.aspectRatio || '1:1' },
                    },
                }),
            }
        );

        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            throw new Error(`Gemini image API ${response.status}: ${errBody.slice(0, 400)}`);
        }

        const data = await response.json();
        for (const cand of data.candidates ?? []) {
            for (const part of cand.content?.parts ?? []) {
                const inline = part.inlineData ?? part.inline_data;
                if (inline?.data) return { imageData: inline.data as string };
            }
        }

        const blocked = data.candidates?.[0]?.finishReason;
        throw new Error(
            `Gemini returned no image (finishReason=${blocked ?? 'unknown'}, body=${JSON.stringify(data).slice(0, 200)})`
        );
    }

    /** Generate music via Google Lyria RealTime (lyria-realtime-exp) */
    async generateMusic(mood: string, durationSeconds?: number): Promise<{ audioData: ArrayBuffer } | null> {
        const duration = durationSeconds || 30;
        // 48kHz stereo 16-bit PCM: sampleRate * channels * bytesPerSample * seconds
        const targetBytes = duration * 48000 * 2 * 2;

        try {
            const ai = new GoogleGenAI({ apiKey: this.apiKey, httpOptions: { apiVersion: 'v1alpha' } });
            const pcmChunks: Buffer[] = [];
            let totalBytes = 0;

            const session = await ai.live.music.connect({
                model: 'models/lyria-realtime-exp',
                callbacks: {
                    onmessage: (e: LiveMusicServerMessage) => {
                        if (e.serverContent?.audioChunks) {
                            for (const chunk of e.serverContent.audioChunks) {
                                if (chunk.data) {
                                    const buf = Buffer.from(chunk.data, 'base64');
                                    pcmChunks.push(buf);
                                    totalBytes += buf.length;
                                }
                            }
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('[Lyria] WebSocket error:', e.message);
                    },
                    onclose: () => {
                        console.log('[Lyria] Connection closed');
                    },
                },
            });

            await session.setWeightedPrompts({
                weightedPrompts: [
                    { text: `${mood} instrumental background music`, weight: 1.0 },
                ],
            });

            session.play();

            // Poll until we have enough PCM data or timeout
            const timeoutMs = Math.max(duration * 1.5, 45) * 1000; // at least 45s
            const startTime = Date.now();
            while (totalBytes < targetBytes && (Date.now() - startTime) < timeoutMs) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            session.close();

            if (totalBytes === 0) {
                console.error('[Lyria] No audio data received');
                return null;
            }

            // Combine PCM chunks and convert to Int16Array
            const combinedPcm = Buffer.concat(pcmChunks);
            const pcmInt16 = new Int16Array(
                combinedPcm.buffer,
                combinedPcm.byteOffset,
                combinedPcm.byteLength / 2
            );

            const mp3Buffer = pcmToMp3(pcmInt16);
            console.log(`[Lyria] Generated ${duration}s music: ${totalBytes} bytes PCM → ${mp3Buffer.byteLength} bytes MP3`);
            return { audioData: mp3Buffer };
        } catch (error) {
            console.error('[Lyria] Music generation failed:', error instanceof Error ? error.message : error);
            return null;
        }
    }
}

export const gemini = new GeminiClient();
