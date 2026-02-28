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

// ── Multi-scene types ──

export interface HeyGenCharacter {
    type: 'avatar';
    avatar_id: string;
    avatar_style?: string;
}

export interface HeyGenVoiceAudio {
    type: 'audio';
    audio_url: string;
}

export interface HeyGenVoiceText {
    type: 'text';
    voice_id: string;
    input_text: string;
}

export interface HeyGenVoiceSilence {
    type: 'silence';
    duration: number;
}

export type HeyGenVoice = HeyGenVoiceAudio | HeyGenVoiceText | HeyGenVoiceSilence;

export interface HeyGenBackgroundColor {
    type: 'color';
    value: string;
}

export interface HeyGenBackgroundImage {
    type: 'image';
    url: string;
}

export type HeyGenBackground = HeyGenBackgroundColor | HeyGenBackgroundImage;

export interface HeyGenTextElement {
    type: 'text';
    value: string;
    style?: {
        font_size?: number;
        font_color?: string;
        background_color?: string;
        position?: { x: number; y: number };
        size?: { width: number; height: number };
    };
}

export interface HeyGenScene {
    character?: HeyGenCharacter;
    voice: HeyGenVoice;
    background: HeyGenBackground;
    elements?: HeyGenTextElement[];
}

export interface HeyGenMultiSceneOptions {
    scenes: HeyGenScene[];
    dimension?: { width: number; height: number };
    callback_url?: string;
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

    async createVideoFromAudio(avatarId: string, audioUrl: string, options?: {
        background?: string;
    }): Promise<HeyGenVideoResponse> {
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
                    value: options?.background || '#1a1a2e',
                },
            }],
            dimension: { width: 1080, height: 1920 },
        });
    }

    async createVideoFromText(avatarId: string, script: string, voiceId?: string, options?: {
        background?: string;
    }): Promise<HeyGenVideoResponse> {
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
                    value: options?.background || '#1a1a2e',
                },
            }],
            dimension: { width: 1080, height: 1920 },
        });
    }

    async createMultiSceneVideo(options: HeyGenMultiSceneOptions): Promise<HeyGenVideoResponse> {
        const body: Record<string, unknown> = {
            video_inputs: options.scenes,
            dimension: options.dimension || { width: 1080, height: 1920 },
        };
        if (options.callback_url) {
            body.callback_url = options.callback_url;
        }
        return this.request<HeyGenVideoResponse>('/v2/video/generate', 'POST', body);
    }

    async getVideoStatus(videoId: string): Promise<HeyGenStatusResponse> {
        return this.request<HeyGenStatusResponse>(`/v1/video_status.get?video_id=${videoId}`);
    }
}

export const heygen = new HeyGenClient();
