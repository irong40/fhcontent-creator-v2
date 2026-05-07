import type { PieceType } from '@/types/database';
import type { Platform } from '@/lib/blotato';

/**
 * Platform distribution matrix:
 * - long video  → tiktok, instagram, youtube
 * - short 1-4   → tiktok, instagram, youtube, threads, twitter, bluesky
 * - carousel    → instagram
 */
export function getTargetPlatforms(pieceType: PieceType): Platform[] {
    switch (pieceType) {
        case 'long':
            return ['tiktok', 'instagram', 'youtube'];
        case 'short_1':
        case 'short_2':
        case 'short_3':
        case 'short_4':
            return ['tiktok', 'instagram', 'youtube', 'threads', 'twitter', 'bluesky'];
        case 'carousel':
            return ['instagram'];
        default:
            return [];
    }
}

export function getMediaUrl(piece: { piece_type: string; carousel_url: string | null; video_url: string | null }): string | null {
    if (piece.piece_type === 'carousel') {
        if (!piece.carousel_url) return null;
        // If stored as JSON array, return first URL for primary media
        if (piece.carousel_url.startsWith('[')) {
            const urls = JSON.parse(piece.carousel_url) as string[];
            return urls[0] || null;
        }
        return piece.carousel_url;
    }
    return piece.video_url;
}

export function getCarouselUrls(piece: { carousel_url: string | null }): string[] {
    if (!piece.carousel_url) return [];
    if (piece.carousel_url.startsWith('[')) {
        return JSON.parse(piece.carousel_url) as string[];
    }
    return [piece.carousel_url];
}

export function isTextOnlyPlatform(platform: Platform): boolean {
    return ['threads', 'twitter', 'bluesky'].includes(platform);
}

const TIKTOK_TITLE_MAX = 90;
const INSTAGRAM_HASHTAG_MAX = 5;

export function truncateTikTokTitle(title: string, max: number = TIKTOK_TITLE_MAX): string {
    const t = (title ?? '').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + '…';
}

export function capInstagramHashtags(text: string, max: number = INSTAGRAM_HASHTAG_MAX): string {
    if (!text) return text;
    const tagRe = /#[\p{L}\p{N}_]+/gu;
    let kept = 0;
    return text.replace(tagRe, (m) => {
        kept += 1;
        return kept <= max ? m : '';
    }).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trimEnd();
}
