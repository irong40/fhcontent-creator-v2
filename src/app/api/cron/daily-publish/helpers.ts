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
    if (piece.piece_type === 'carousel') return piece.carousel_url;
    return piece.video_url;
}

export function isTextOnlyPlatform(platform: Platform): boolean {
    return ['threads', 'twitter', 'bluesky'].includes(platform);
}
