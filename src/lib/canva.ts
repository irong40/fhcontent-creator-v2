/**
 * Canva API Client
 * Design generation and carousel creation
 */

class CanvaClient {
    private readonly baseUrl = 'https://api.canva.com';
    private readonly apiKey: string;

    constructor() {
        this.apiKey = (process.env.CANVA_API_KEY || '').trim();
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
            throw new Error(`Canva API error (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.request('/v1/users/me/profile');
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    async getUserProfile(): Promise<unknown> {
        return this.request('/v1/users/me/profile');
    }

    async listBrandKits(): Promise<unknown> {
        return this.request('/v1/brand-templates');
    }

    async createDesign(templateId: string, data: Record<string, unknown>): Promise<unknown> {
        return this.request('/v1/designs', 'POST', {
            template_id: templateId,
            ...data,
        });
    }

    async exportDesign(designId: string, format: 'png' | 'jpg' | 'pdf' = 'png'): Promise<unknown> {
        return this.request(`/v1/designs/${designId}/exports`, 'POST', { format });
    }
}

export const canva = new CanvaClient();
