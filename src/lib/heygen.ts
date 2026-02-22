/**
 * HeyGen API Client
 * AI avatar video generation
 */

export interface HeyGenVideoResponse {
    data: {
        video_id: string;
    };
}

export interface HeyGenStatusResponse {
    data: {
        status: 'pending' | 'processing' | 'completed' | 'failed';
        video_url: string | null;
        duration: number | null;
        error: string | null;
    };
}

export interface HeyGenAvatarListResponse {
    data: {
        avatars: Array<{
            avatar_id: string;
            avatar_name: string;
        }>;
    };
}

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

    async listAvatars(): Promise<HeyGenAvatarListResponse> {
        return this.request<HeyGenAvatarListResponse>('/v2/avatars');
    }

    async createVideoFromAudio(avatarId: string, audioUrl: string): Promise<HeyGenVideoResponse> {
        return this.request<HeyGenVideoResponse>('/v2/video/generate', 'POST', {
            video_inputs: [{
                character: {
                    type: 'avatar',
                    avatar_id: avatarId,
                    avatar_style: 'normal',
                },
                voice: {
                    type: 'audio',
                    audio_url: audioUrl,
                },
                background: {
                    type: 'color',
                    value: '#000000',
                },
            }],
            dimension: { width: 1080, height: 1920 },
        });
    }

    async createVideoFromText(avatarId: string, script: string, voiceId?: string): Promise<HeyGenVideoResponse> {
        const voice: Record<string, unknown> = voiceId
            ? { type: 'text', voice_id: voiceId, input_text: script }
            : { type: 'text', input_text: script };

        return this.request<HeyGenVideoResponse>('/v2/video/generate', 'POST', {
            video_inputs: [{
                character: {
                    type: 'avatar',
                    avatar_id: avatarId,
                    avatar_style: 'normal',
                },
                voice,
                background: {
                    type: 'color',
                    value: '#000000',
                },
            }],
            dimension: { width: 1080, height: 1920 },
        });
    }

    async getVideoStatus(videoId: string): Promise<HeyGenStatusResponse> {
        return this.request<HeyGenStatusResponse>(`/v1/video_status.get?video_id=${videoId}`);
    }
}

export const heygen = new HeyGenClient();
