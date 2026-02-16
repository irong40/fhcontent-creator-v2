/**
 * Canva Connect API Client
 * Design generation and carousel creation
 * API Reference: https://www.canva.dev/docs/connect/
 */

export type AutofillField =
    | { type: 'text'; text: string }
    | { type: 'image'; asset_id: string };

export type AutofillData = Record<string, AutofillField>;

interface CanvaJob {
    id: string;
    status: 'in_progress' | 'success' | 'failed';
    error?: { code: string; message: string };
}

interface AssetUploadJob extends CanvaJob {
    asset?: { id: string };
}

interface AutofillJob extends CanvaJob {
    result?: { design: { id: string } };
}

interface ExportJob extends CanvaJob {
    urls?: string[];
}

class CanvaClient {
    private readonly baseUrl = 'https://api.canva.com/rest';
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

    /** Poll an async job endpoint until success or failure */
    private async pollJob<T extends CanvaJob>(endpoint: string, timeoutMs: number = 60000): Promise<T> {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const data = await this.request<{ job: T }>(endpoint);
            if (data.job.status === 'success') return data.job;
            if (data.job.status === 'failed') {
                throw new Error(`Canva job failed: ${data.job.error?.message || 'unknown error'}`);
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        throw new Error('Canva job polling timed out');
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.request('/v1/users/me/profile');
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    /** Upload an image to Canva as an asset and return the asset ID */
    async uploadAsset(name: string, data: ArrayBuffer): Promise<string> {
        const nameBase64 = btoa(name.slice(0, 50));
        const response = await fetch(`${this.baseUrl}/v1/asset-uploads`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/octet-stream',
                'Asset-Upload-Metadata': JSON.stringify({ name_base64: nameBase64 }),
            },
            body: data,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Canva asset upload failed (${response.status}): ${errorText}`);
        }

        const { job } = await response.json() as { job: AssetUploadJob };

        if (job.status === 'success' && job.asset?.id) {
            return job.asset.id;
        }

        const completed = await this.pollJob<AssetUploadJob>(`/v1/asset-uploads/${job.id}`);
        if (!completed.asset?.id) throw new Error('Canva asset upload succeeded but no asset ID returned');
        return completed.asset.id;
    }

    /** Create a design from a brand template using autofill, returns design ID */
    async createDesignAutofill(templateId: string, data: AutofillData): Promise<string> {
        const result = await this.request<{ job: AutofillJob }>(
            '/v1/autofills',
            'POST',
            { brand_template_id: templateId, data },
        );

        const job = result.job;

        if (job.status === 'success' && job.result?.design?.id) {
            return job.result.design.id;
        }

        const completed = await this.pollJob<AutofillJob>(`/v1/autofills/${job.id}`);
        if (!completed.result?.design?.id) throw new Error('Canva autofill succeeded but no design ID returned');
        return completed.result.design.id;
    }

    /** Export a design and return download URLs (polls until complete) */
    async exportDesign(designId: string, format: 'png' | 'jpg' | 'pdf' = 'png'): Promise<string[]> {
        const result = await this.request<{ job: ExportJob }>(
            '/v1/exports',
            'POST',
            { design_id: designId, format: { type: format } },
        );

        const job = result.job;

        if (job.status === 'success' && job.urls) {
            return job.urls;
        }

        const completed = await this.pollJob<ExportJob>(`/v1/exports/${job.id}`);
        if (!completed.urls) throw new Error('Canva export succeeded but no URLs returned');
        return completed.urls;
    }
}

export const canva = new CanvaClient();
