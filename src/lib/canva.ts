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

    async exportDesign(designId: string, format: 'png' | 'jpg' | 'pdf' = 'png'): Promise<{ id: string }> {
        return this.request<{ id: string }>(`/v1/designs/${designId}/exports`, 'POST', { format });
    }

    /** Create a design from a template using autofill (placeholder replacement) */
    async createDesignAutofill(templateId: string, data: Record<string, string>): Promise<{ designId: string }> {
        const result = await this.request<{ design: { id: string } }>('/v1/autofills', 'POST', {
            brand_template_id: templateId,
            data,
        });
        return { designId: result.design.id };
    }

    /** Check the status of an export job */
    async getExportJob(exportId: string): Promise<{ status: string; urls?: string[] }> {
        const result = await this.request<{ status: string; urls?: Array<{ url: string }> }>(
            `/v1/exports/${exportId}`,
        );
        return {
            status: result.status,
            urls: result.urls?.map(u => u.url),
        };
    }

    /** Poll an export job until complete or timeout */
    async pollExport(exportId: string, timeoutMs: number = 60000): Promise<string[]> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const job = await this.getExportJob(exportId);
            if (job.status === 'completed' && job.urls) {
                return job.urls;
            }
            if (job.status === 'failed') {
                throw new Error('Canva export job failed');
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        throw new Error('Canva export polling timed out');
    }
}

export const canva = new CanvaClient();
