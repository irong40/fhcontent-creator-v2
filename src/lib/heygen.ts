/**
 * HeyGen API Client
 * AI avatar video generation
 */

class HeyGenClient {
    private readonly baseUrl = 'https://api.heygen.com';
    private readonly apiKey: string;

    constructor() {
        this.apiKey = (process.env.HEYGEN_API_KEY || '').trim();
    }

    private async request<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': this.apiKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HeyGen API error (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.request('/v2/avatars');
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    async listAvatars(): Promise<unknown> {
        return this.request('/v2/avatars');
    }

    async createVideo(avatarId: string, script: string, voiceId?: string): Promise<unknown> {
        return this.request('/v2/video/generate', 'POST', {
            video_inputs: [{
                character: {
                    type: 'avatar',
                    avatar_id: avatarId,
                    avatar_style: 'normal',
                },
                voice: voiceId ? {
                    type: 'audio',
                    audio_url: voiceId,
                } : {
                    type: 'text',
                    input_text: script,
                },
                background: {
                    type: 'color',
                    value: '#000000',
                },
            }],
            dimension: { width: 1080, height: 1920 },
        });
    }

    async getVideoStatus(videoId: string): Promise<unknown> {
        return this.request(`/v1/video_status.get?video_id=${videoId}`);
    }
}

export const heygen = new HeyGenClient();
