/**
 * Blotato API Client
 *
 * Official API integration based on:
 * https://help.blotato.com/api/api-reference
 *
 * Base URL: https://backend.blotato.com/v2
 */

// ============================================================================
// TYPES
// ============================================================================

export type Platform = 'twitter' | 'linkedin' | 'facebook' | 'instagram' | 'pinterest' | 'tiktok' | 'threads' | 'bluesky' | 'youtube';

export type VideoStatus = 'Queued' | 'Processing' | 'Done' | 'Failed';

export interface BlotatoVideoCreateRequest {
    templateId: string;
    inputs: Record<string, unknown>;
    prompt?: string;
    render?: boolean;
    isDraft?: boolean;
}

export interface BlotatoVideoCreateResponse {
    item: {
        id: string;
        status: VideoStatus;
        createdAt?: string;
    };
}

export interface BlotatoVideoStatusResponse {
    item: {
        id: string;
        status: VideoStatus;
        createdAt: string;
        mediaUrl: string | null;
        imageUrls: string[] | null;
    };
}

export interface BlotatoPostContent {
    text: string;
    mediaUrls: string[];
    platform: Platform;
    additionalPosts?: Array<{
        text: string;
        mediaUrls: string[];
    }>;
}

export interface TwitterTarget {
    targetType: 'twitter';
}

export interface LinkedInTarget {
    targetType: 'linkedin';
    pageId?: string;
}

export interface FacebookTarget {
    targetType: 'facebook';
    pageId: string;
    mediaType?: 'video' | 'reel';
    link?: string;
}

export interface InstagramTarget {
    targetType: 'instagram';
    mediaType?: 'reel' | 'story';
    altText?: string;
    collaborators?: string[];
    coverImageUrl?: string;
}

export interface PinterestTarget {
    targetType: 'pinterest';
    boardId: string;
    title?: string;
    altText?: string;
    link?: string;
}

export interface YouTubeTarget {
    targetType: 'youtube';
    title: string;
    privacyStatus: 'private' | 'public' | 'unlisted';
    shouldNotifySubscribers: boolean;
    isMadeForKids?: boolean;
    containsSyntheticMedia?: boolean;
}

export interface TikTokTarget {
    targetType: 'tiktok';
    privacyLevel: 'SELF_ONLY' | 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR';
    disabledComments: boolean;
    disabledDuet: boolean;
    disabledStitch: boolean;
    isBrandedContent: boolean;
    isYourBrand: boolean;
    isAiGenerated: boolean;
    title?: string;
    autoAddMusic?: boolean;
    isDraft?: boolean;
}

export type BlotatoTarget =
    | TwitterTarget
    | LinkedInTarget
    | FacebookTarget
    | InstagramTarget
    | PinterestTarget
    | YouTubeTarget
    | TikTokTarget;

export interface BlotatoPost {
    accountId: string;
    content: BlotatoPostContent;
    target: BlotatoTarget;
}

export interface BlotatoPublishRequest {
    post: BlotatoPost;
    scheduledTime?: string;
    useNextFreeSlot?: boolean;
}

export interface BlotatoPublishResponse {
    postSubmissionId: string;
}

export interface BlotatoUploadMediaResponse {
    url: string;
}

export interface BlotatoPostStatus {
    id: string;
    status: 'pending' | 'processing' | 'published' | 'failed';
    createdAt: string;
    publishedAt?: string;
    error?: string;
    platformPostId?: string;
}

export interface BlotatoTemplateInfo {
    id: string;
    name: string;
    description: string;
    inputs: Record<string, {
        type: 'text' | 'number' | 'boolean' | 'enum' | 'image' | 'video' | 'color' | 'array' | 'object';
        required?: boolean;
        default?: unknown;
        options?: string[];
    }>;
}

export interface BlotatoAccount {
    id: string;
    platform: Platform;
    fullname: string;
    username: string;
}

export interface BlotatoSubAccount {
    id: string;
    accountId: string;
    name: string;
}

export interface BlotatoUser {
    id: string;
    subscriptionStatus: string;
    apiKey?: string;
}

// ============================================================================
// TARGET BUILDER
// ============================================================================

export function buildTarget(platform: Platform, options: {
    title?: string;
    isAiGenerated?: boolean;
} = {}): BlotatoTarget {
    switch (platform) {
        case 'tiktok':
            return {
                targetType: 'tiktok',
                privacyLevel: 'PUBLIC_TO_EVERYONE',
                disabledComments: false,
                disabledDuet: false,
                disabledStitch: false,
                isBrandedContent: false,
                isYourBrand: true,
                isAiGenerated: options.isAiGenerated ?? true,
                title: options.title,
            };
        case 'instagram':
            return {
                targetType: 'instagram',
                mediaType: 'reel',
            };
        case 'youtube':
            return {
                targetType: 'youtube',
                title: options.title || 'Untitled',
                privacyStatus: 'public',
                shouldNotifySubscribers: true,
                isMadeForKids: false,
                containsSyntheticMedia: true,
            };
        case 'twitter':
            return { targetType: 'twitter' };
        case 'linkedin':
            return { targetType: 'linkedin' };
        case 'threads':
        case 'bluesky':
        default:
            return { targetType: platform } as unknown as BlotatoTarget;
    }
}

// ============================================================================
// CLIENT
// ============================================================================

class BlotatoClient {
    private readonly baseUrl = 'https://backend.blotato.com/v2';
    private readonly apiKey: string;

    constructor() {
        this.apiKey = (process.env.BLOTATO_API_KEY || '').trim();
    }

    private async request<T>(
        endpoint: string,
        method: 'GET' | 'POST' | 'DELETE' = 'POST',
        body?: Record<string, unknown>
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            'blotato-api-key': this.apiKey,
        };

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Blotato API error (${response.status}): ${errorText}`);
        }

        return response.json();
    }

    // =========================================================================
    // CONNECTION TEST
    // =========================================================================

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try {
            await this.getCurrentUser();
            return { ok: true };
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
        }
    }

    // =========================================================================
    // ACCOUNTS
    // =========================================================================

    async getCurrentUser(): Promise<BlotatoUser> {
        return this.request<BlotatoUser>('/users/me', 'GET');
    }

    async getAccounts(platform?: Platform): Promise<BlotatoAccount[]> {
        const endpoint = '/users/me/accounts' + (platform ? `?platform=${platform}` : '');
        const response = await this.request<{ items: BlotatoAccount[][] }>(endpoint, 'GET');
        return response.items.flat();
    }

    async getSubAccounts(accountId: string): Promise<BlotatoSubAccount[]> {
        const response = await this.request<{ items: BlotatoSubAccount[] }>(`/users/me/accounts/${accountId}/subaccounts`, 'GET');
        return response.items;
    }

    // =========================================================================
    // VIDEO CREATION
    // =========================================================================

    async createVideo(request: BlotatoVideoCreateRequest): Promise<BlotatoVideoCreateResponse> {
        return this.request<BlotatoVideoCreateResponse>('/videos/from-templates', 'POST', request as unknown as Record<string, unknown>);
    }

    async createVideoFromPrompt(
        templateId: string,
        prompt: string,
        overrides?: Record<string, unknown>
    ): Promise<BlotatoVideoCreateResponse> {
        return this.createVideo({
            templateId,
            prompt,
            inputs: overrides || {},
        });
    }

    async getTemplates(search?: string): Promise<BlotatoTemplateInfo[]> {
        const params = new URLSearchParams({
            fields: 'id,name,description,inputs',
        });
        if (search) params.append('search', search);
        return this.request<BlotatoTemplateInfo[]>(`/videos/templates?${params.toString()}`, 'GET');
    }

    async getVideoStatus(videoId: string): Promise<BlotatoVideoStatusResponse> {
        return this.request<BlotatoVideoStatusResponse>(`/videos/creations/${videoId}`, 'GET');
    }

    async deleteVideo(videoId: string): Promise<void> {
        await this.request(`/videos/${videoId}`, 'DELETE');
    }

    async waitForVideo(
        videoId: string,
        options?: {
            pollIntervalMs?: number;
            timeoutMs?: number;
            onProgress?: (status: VideoStatus) => void;
        }
    ): Promise<BlotatoVideoStatusResponse> {
        const pollInterval = options?.pollIntervalMs || 10000;
        const timeout = options?.timeoutMs || 600000;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const status = await this.getVideoStatus(videoId);
            options?.onProgress?.(status.item.status);
            if (status.item.status === 'Done') return status;
            if (status.item.status === 'Failed') throw new Error(`Video creation failed for ID: ${videoId}`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        throw new Error(`Video creation timed out after ${timeout}ms`);
    }

    // =========================================================================
    // MEDIA UPLOAD
    // =========================================================================

    async uploadMedia(url: string): Promise<BlotatoUploadMediaResponse> {
        return this.request<BlotatoUploadMediaResponse>('/media', 'POST', { url });
    }

    async uploadMediaBase64(base64Data: string, mimeType: string): Promise<BlotatoUploadMediaResponse> {
        const dataUrl = `data:${mimeType};base64,${base64Data}`;
        return this.uploadMedia(dataUrl);
    }

    // =========================================================================
    // PUBLISHING
    // =========================================================================

    async publishPost(request: BlotatoPublishRequest): Promise<BlotatoPublishResponse> {
        return this.request<BlotatoPublishResponse>('/posts', 'POST', request as unknown as Record<string, unknown>);
    }

    async publishNow(
        accountId: string,
        platform: Platform,
        text: string,
        mediaUrls: string[] = [],
        options?: { pageId?: string; mediaType?: 'video' | 'reel' }
    ): Promise<BlotatoPublishResponse> {
        return this.publishPost({
            post: {
                accountId,
                content: { text, mediaUrls, platform },
                target: {
                    targetType: platform,
                    pageId: options?.pageId,
                    mediaType: options?.mediaType,
                } as unknown as BlotatoTarget,
            },
        });
    }

    async getPostStatus(postSubmissionId: string): Promise<BlotatoPostStatus> {
        return this.request<BlotatoPostStatus>(`/posts/${postSubmissionId}`, 'GET');
    }

    async schedulePost(
        accountId: string,
        platform: Platform,
        text: string,
        scheduledTime: Date | string,
        mediaUrls: string[] = [],
        options?: { pageId?: string }
    ): Promise<BlotatoPublishResponse> {
        const isoTime = scheduledTime instanceof Date ? scheduledTime.toISOString() : scheduledTime;
        return this.publishPost({
            post: {
                accountId,
                content: { text, mediaUrls, platform },
                target: {
                    targetType: platform,
                    pageId: options?.pageId,
                } as unknown as BlotatoTarget,
            },
            scheduledTime: isoTime,
        });
    }

    async publishToMultiple(
        accounts: Array<{ accountId: string; platform: Platform; pageId?: string }>,
        text: string,
        mediaUrls: string[] = [],
        scheduledTime?: Date | string
    ): Promise<Record<string, BlotatoPublishResponse | { error: string }>> {
        const results: Record<string, BlotatoPublishResponse | { error: string }> = {};
        for (const account of accounts) {
            try {
                if (scheduledTime) {
                    results[account.platform] = await this.schedulePost(account.accountId, account.platform, text, scheduledTime, mediaUrls, { pageId: account.pageId });
                } else {
                    results[account.platform] = await this.publishNow(account.accountId, account.platform, text, mediaUrls, { pageId: account.pageId });
                }
            } catch (error) {
                results[account.platform] = { error: error instanceof Error ? error.message : 'Unknown error' };
            }
        }
        return results;
    }
}

export const blotato = new BlotatoClient();
