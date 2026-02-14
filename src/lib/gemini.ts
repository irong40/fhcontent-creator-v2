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
}

export const gemini = new GeminiClient();
