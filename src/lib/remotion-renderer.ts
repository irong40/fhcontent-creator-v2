/**
 * Remotion Local Render Client
 *
 * Drop-in replacement for HeyGen API client.
 * Sends render requests to the local SAI Training Video render server
 * at localhost:3200. Same async job pattern: submit → poll status.
 */

const RENDER_SERVER = process.env.REMOTION_RENDER_URL || 'http://localhost:3200';

export interface RemotionRenderResponse {
    success: boolean;
    jobId: string;
    statusUrl: string;
}

export interface RemotionStatusResponse {
    success: boolean;
    status: 'queued' | 'rendering' | 'completed' | 'failed';
    videoPath?: string;
    videoUrl?: string;
    error?: string;
    renderTimeMs?: number;
}

export interface RemotionChapter {
    title: string;
    startFrame: number;
    durationFrames: number;
    narrationText?: string;
}

class RemotionClient {
    private readonly baseUrl: string;

    constructor() {
        this.baseUrl = RENDER_SERVER;
    }

    private async request<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Remotion render server error (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            const health = await this.request<{ ok: boolean }>('/health');
            return { ok: health.ok };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    /**
     * Render a long-form training video.
     * Replaces heygen.createVideoFromAudio().
     */
    async createTrainingVideo(
        title: string,
        audioUrl: string,
        options?: {
            subtitle?: string;
            chapters?: RemotionChapter[];
            backgroundImageUrl?: string;
            outputFileName?: string;
        },
    ): Promise<RemotionRenderResponse> {
        const fps = 30;
        // Default single chapter if none provided
        const chapters = options?.chapters || [{
            title,
            startFrame: 0,
            durationFrames: 10 * fps, // 10s placeholder
            narrationText: title,
        }];

        const totalFrames = (3 * fps) + // intro
            chapters.reduce((sum, ch) => sum + ch.durationFrames, 0) +
            (4 * fps); // outro

        return this.request<RemotionRenderResponse>('/render', 'POST', {
            compositionId: 'TrainingVideo',
            outputFileName: options?.outputFileName || `training_${Date.now()}.mp4`,
            inputProps: {
                title,
                subtitle: options?.subtitle,
                chapters,
                audioUrl,
                backgroundImageUrl: options?.backgroundImageUrl,
                totalDurationFrames: totalFrames,
            },
        });
    }

    /**
     * Render a short-form social clip (9:16).
     * Replaces Blotato faceless video for training content.
     */
    async createShortClip(
        title: string,
        script: string,
        options?: {
            audioUrl?: string;
            backgroundImageUrl?: string;
            outputFileName?: string;
        },
    ): Promise<RemotionRenderResponse> {
        // Parse script into hook + body lines
        const lines = script.split('\n').filter(l => l.trim());
        const hookText = lines[0] || title;
        const bodyLines = lines.slice(1, 6); // Max 5 body lines
        const ctaText = 'Follow for more field guides';

        return this.request<RemotionRenderResponse>('/render', 'POST', {
            compositionId: 'ShortClip',
            outputFileName: options?.outputFileName || `short_${Date.now()}.mp4`,
            inputProps: {
                title,
                hookText,
                bodyLines,
                ctaText,
                audioUrl: options?.audioUrl,
                backgroundImageUrl: options?.backgroundImageUrl,
            },
            width: 1080,
            height: 1920,
        });
    }

    /**
     * Check render job status.
     * Replaces heygen.getVideoStatus().
     */
    async getJobStatus(jobId: string): Promise<RemotionStatusResponse> {
        return this.request<RemotionStatusResponse>(`/status/${jobId}`);
    }
}

export const remotionRenderer = new RemotionClient();
