/**
 * OpenAI API Client
 * Image generation (gpt-image-1) and embeddings
 */

class OpenAIClient {
    private readonly baseUrl = 'https://api.openai.com';
    private readonly apiKey: string;

    constructor() {
        this.apiKey = (process.env.OPENAI_API_KEY || '').trim();
    }

    private async request<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.request('/v1/models');
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    /**
     * Generate an image with OpenAI's `gpt-image-1` model.
     *
     * NOTE: `dall-e-3` was retired from this account ("model does not exist",
     * 400) — `gpt-image-1` is the current image model. Unlike DALL-E 3,
     * gpt-image-1 ALWAYS returns base64 (`b64_json`) and never a `url`, so this
     * returns the decoded image bytes directly. Its `size` and `quality`
     * vocabularies also differ (square is `1024x1024`; quality is
     * `low|medium|high|auto`, default `auto`).
     */
    async generateImage(prompt: string, options?: {
        model?: string;
        size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
        quality?: 'low' | 'medium' | 'high' | 'auto';
    }): Promise<{ imageData: string }> {
        const response = await this.request<{ data: Array<{ b64_json?: string }> }>(
            '/v1/images/generations',
            'POST',
            {
                model: options?.model || 'gpt-image-1',
                prompt,
                n: 1,
                size: options?.size || '1024x1024',
                quality: options?.quality || 'auto',
            },
        );
        const b64 = response.data?.[0]?.b64_json;
        if (!b64) {
            throw new Error('gpt-image-1 returned no b64_json image data');
        }
        return { imageData: b64 };
    }
}

export const openai = new OpenAIClient();
