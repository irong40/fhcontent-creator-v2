/**
 * OpenAI API Client
 * Image generation (DALL-E) and embeddings
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

    async generateImage(prompt: string, options?: {
        model?: string;
        size?: '1024x1024' | '1024x1792' | '1792x1024';
        quality?: 'standard' | 'hd';
    }): Promise<{ url: string }> {
        const response = await this.request<{ data: Array<{ url: string }> }>('/v1/images/generations', 'POST', {
            model: options?.model || 'dall-e-3',
            prompt,
            n: 1,
            size: options?.size || '1024x1024',
            quality: options?.quality || 'standard',
        });
        return { url: response.data[0].url };
    }
}

export const openai = new OpenAIClient();
