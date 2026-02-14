/**
 * ElevenLabs API Client
 * Text-to-speech voice generation
 */

export interface ElevenLabsVoice {
    voice_id: string;
    name: string;
    labels?: Record<string, string>;
}

class ElevenLabsClient {
    private readonly baseUrl = 'https://api.elevenlabs.io';
    private readonly apiKey: string;

    constructor() {
        this.apiKey = (process.env.ELEVENLABS_API_KEY || '').trim();
    }

    private async request<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': this.apiKey,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.getVoices();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    async getVoices(): Promise<ElevenLabsVoice[]> {
        const response = await this.request<{ voices: ElevenLabsVoice[] }>('/v1/voices');
        return response.voices;
    }

    async textToSpeech(voiceId: string, text: string, options?: {
        modelId?: string;
        stability?: number;
        similarityBoost?: number;
    }): Promise<ArrayBuffer> {
        const response = await fetch(`${this.baseUrl}/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': this.apiKey,
            },
            body: JSON.stringify({
                text,
                model_id: options?.modelId || 'eleven_multilingual_v2',
                voice_settings: {
                    stability: options?.stability ?? 0.5,
                    similarity_boost: options?.similarityBoost ?? 0.75,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ElevenLabs TTS error (${response.status}): ${errorText}`);
        }

        return response.arrayBuffer();
    }
}

export const elevenlabs = new ElevenLabsClient();
