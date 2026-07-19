import type { PieceType, PlatformAccounts } from '@/types/database';
import type { Platform } from '@/lib/blotato';

/**
 * Platform distribution matrix:
 * - long video  → tiktok, instagram, youtube, facebook
 * - short 1-4   → tiktok, instagram, youtube, threads, twitter, facebook
 * - carousel    → instagram
 *
 * Facebook (Reels) is in the video lists but is gated in
 * getConfiguredTargetPlatforms behind a per-persona opt-in (facebook_enabled)
 * so it stays off for the personas configured with FB pages but not yet
 * cleared to auto-post — only opted-in personas (e.g. Sentinel Aerial) publish
 * to FB.
 *
 * NOTE: Bluesky disabled 2026-05-10 per Adam — no accounts wired up, was
 * generating spurious 'No account configured' failure rows. Re-add to the
 * short_* list when an account is configured on personas.platform_accounts.
 */
export function getTargetPlatforms(pieceType: PieceType): Platform[] {
    switch (pieceType) {
        case 'long':
            return ['tiktok', 'instagram', 'youtube', 'facebook'];
        case 'short_1':
        case 'short_2':
        case 'short_3':
        case 'short_4':
            return ['tiktok', 'instagram', 'youtube', 'threads', 'twitter', 'facebook'];
        case 'carousel':
            return ['instagram'];
        case 'quote_video':
            // Looping quote card (<5s video, 10s+ read time). Video platforms
            // only — the loop-replay view mechanic doesn't exist on text feeds.
            return ['tiktok', 'instagram', 'youtube', 'facebook'];
        default:
            return [];
    }
}

/**
 * The Facebook Page id to publish a persona's video to. Prefers the persona's
 * facebook_page_ids array (first entry — single-page for now; multi-page is a
 * later change), falling back to the legacy platform_accounts.facebook_page.
 * Returns null when no page is configured, which keeps FB out of the target
 * list rather than submitting a page-less (and rejected) FB post.
 */
export function resolveFacebookPageId(
    accounts: PlatformAccounts | null | undefined,
    facebookPageIds: string[] | null | undefined,
): string | null {
    // Normalize both sources: a whitespace-only or empty id must resolve to
    // null (not reach Blotato as pageId: "") — Codex review 2026-07-18, Minor 1.
    const fromArray = facebookPageIds?.[0]?.trim();
    if (fromArray) return fromArray;
    const legacy = accounts?.facebook_page?.trim();
    return legacy || null;
}

/**
 * Returns the publishable target platforms for a piece, filtered by which ones
 * actually have an account_id on the persona. Avoids spurious "No account
 * configured" failure rows when a persona simply hasn't connected a given
 * network yet (e.g. Dr. Carter has no Bluesky).
 *
 * Facebook is special: it requires the persona to be explicitly opted in
 * (fb.enabled), to have a connected FB account (accounts.facebook), AND to have
 * a resolvable Page id. This keeps FB posting off for personas that carry FB
 * config but haven't been cleared to auto-post to their pages.
 */
export function getConfiguredTargetPlatforms(
    pieceType: PieceType,
    accounts: PlatformAccounts | null | undefined,
    fb?: { enabled?: boolean | null; pageIds?: string[] | null },
): Platform[] {
    const all = getTargetPlatforms(pieceType);
    if (!accounts) return [];
    return all.filter((p) => {
        if (p === 'facebook') {
            return Boolean(fb?.enabled)
                && Boolean(accounts.facebook)
                && resolveFacebookPageId(accounts, fb?.pageIds) !== null;
        }
        return Boolean(accounts[p as keyof PlatformAccounts]);
    });
}

/**
 * Safe parse for a JSON-array carousel_url value. Returns null on malformed
 * JSON or a non-array payload instead of throwing — one truncated/hand-edited
 * row must not crash publishTopic on every hourly tick forever (there is no
 * retry budget on this path, unlike platform failures; review 2026-07-04).
 * A null return flows into getMediaUrl's existing "no media URL — skipped"
 * warning path, which surfaces in the alert email.
 */
function parseCarouselJson(raw: string): string[] | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((u): u is string => typeof u === 'string');
    } catch {
        console.warn(`[daily-publish] Malformed carousel_url JSON — treating as no media: ${raw.slice(0, 120)}`);
        return null;
    }
}

export function getMediaUrl(piece: { piece_type: string; carousel_url: string | null; video_url: string | null }): string | null {
    if (piece.piece_type === 'carousel') {
        if (!piece.carousel_url) return null;
        // If stored as JSON array, return first URL for primary media
        if (piece.carousel_url.startsWith('[')) {
            const urls = parseCarouselJson(piece.carousel_url);
            return urls?.[0] || null;
        }
        return piece.carousel_url;
    }
    return piece.video_url;
}

export function getCarouselUrls(piece: { carousel_url: string | null }): string[] {
    if (!piece.carousel_url) return [];
    if (piece.carousel_url.startsWith('[')) {
        return parseCarouselJson(piece.carousel_url) ?? [];
    }
    return [piece.carousel_url];
}

export function isTextOnlyPlatform(platform: Platform): boolean {
    return ['threads', 'twitter', 'bluesky'].includes(platform);
}

const TIKTOK_TITLE_MAX = 90;
// Blotato/YouTube reject a post title longer than 100 characters
// (400: "body.post.target.title must NOT have more than 100 characters").
const YOUTUBE_TITLE_MAX = 100;
// Blotato's IG validator rejects posts with MORE THAN 5 hashtags. We've seen
// posts with exactly 5 still rejected (likely an off-by-one in their counter
// or whitespace edge cases), so cap at 4 to stay clear of the boundary.
const INSTAGRAM_HASHTAG_MAX = 4;

/**
 * Hour-of-day offset (in hours) from a topic's publish_at for each piece type.
 * Spreads the 6 pieces across the day so an audience sees fresh content at
 * different waking hours instead of all 6 hitting their feed at 9 AM.
 *
 * Default base publish_at = 13:00 UTC (≈ 9 AM ET / 6 AM PT).
 *
 * | piece    | ET    | UTC   | offset |
 * | short_1  | 9 AM  | 13:00 |  +0h   |
 * | short_2  | 11 AM | 15:00 |  +2h   |
 * | short_3  | 1 PM  | 17:00 |  +4h   |
 * | carousel | 3 PM  | 19:00 |  +6h   |
 * | short_4  | 5 PM  | 21:00 |  +8h   |
 * | long     | 7 PM  | 23:00 | +10h   | <-- evening peak per Adam
 * | lecture  | 7 PM  | 23:00 | +10h   |
 */
export const PIECE_SLOT_OFFSET_HOURS: Record<PieceType, number> = {
    short_1: 0,
    short_2: 2,
    short_3: 4,
    carousel: 6,
    short_4: 8,
    long: 10,
    lecture: 10,
    // Quote personas produce ONE piece/day; +4h = 1 PM ET, clear of the
    // standard personas' 9 AM and 7 PM peaks on shared brand channels.
    quote_video: 4,
};

/**
 * When this piece is allowed to publish, given the topic's base publish_at.
 * Returns null when topicPublishAt is null (legacy topic without staggering).
 */
export function pieceSlotTime(
    pieceType: PieceType,
    topicPublishAt: string | null,
): Date | null {
    if (!topicPublishAt) return null;
    const offsetHours = PIECE_SLOT_OFFSET_HOURS[pieceType] ?? 0;
    return new Date(new Date(topicPublishAt).getTime() + offsetHours * 60 * 60 * 1000);
}

/** Returns true if `now` (default Date.now) is at or past the piece's slot. */
export function isSlotReady(
    pieceType: PieceType,
    topicPublishAt: string | null,
    now: Date = new Date(),
): boolean {
    const slot = pieceSlotTime(pieceType, topicPublishAt);
    if (!slot) return true; // legacy topic with no publish_at — fire immediately
    return now.getTime() >= slot.getTime();
}

export function truncateTikTokTitle(title: string, max: number = TIKTOK_TITLE_MAX): string {
    const t = (title ?? '').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + '…';
}

export function truncateYouTubeTitle(title: string, max: number = YOUTUBE_TITLE_MAX): string {
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
