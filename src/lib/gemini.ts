/**
 * Gemini (Google AI) API Client
 * Alternative LLM for content generation
 */

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

    /** Generate an image using Gemini's Imagen model (fallback for DALL-E) */
    async generateImage(prompt: string, options?: {
        aspectRatio?: string;
    }): Promise<{ imageData: string } | null> {
        try {
            const model = 'gemini-2.0-flash-exp';
            const response = await fetch(
                `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            responseModalities: ['IMAGE'],
                            ...(options?.aspectRatio && { aspectRatio: options.aspectRatio }),
                        },
                    }),
                }
            );

            if (!response.ok) return null;

            const data = await response.json();
            const parts = data.candidates?.[0]?.content?.parts;
            const imagePart = parts?.find((p: Record<string, unknown>) => p.inlineData);
            if (!imagePart?.inlineData?.data) return null;

            return { imageData: imagePart.inlineData.data };
        } catch {
            return null;
        }
    }

    /** Attempt music generation via Gemini Lyria (graceful degradation) */
    async generateMusic(mood: string, durationSeconds?: number): Promise<{ audioData: ArrayBuffer } | null> {
        try {
            const prompt = `Generate a ${durationSeconds || 30}-second background music track with a ${mood} mood. Instrumental only, suitable for social media content.`;
            const model = 'gemini-2.0-flash-exp';
            const response = await fetch(
                `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                        },
                    }),
                }
            );

            if (!response.ok) return null;

            const data = await response.json();
            const parts = data.candidates?.[0]?.content?.parts;
            const audioPart = parts?.find((p: Record<string, unknown>) => p.inlineData);
            if (!audioPart?.inlineData?.data) return null;

            // Decode base64 audio
            const binaryStr = atob(audioPart.inlineData.data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            return { audioData: bytes.buffer };
        } catch {
            return null;
        }
    }
}

export const gemini = new GeminiClient();
