/**
 * Provider-side publish limits and their classification.
 *
 * Root cause of the 2026-07-15/16 YouTube+TikTok failure cluster: a post-outage
 * catch-up storm submitted 16 posts to one YouTube channel in a day. The
 * provider caps uploads per rolling 24h per account, so the overflow came back
 * `failed` — and the field-name bug (Blotato returns `errorMessage`, we read
 * `error`) masked every one of them as a generic "Publishing failed".
 *
 * Two guards live here, both pure so they unit-test without a DB or network:
 *  1. PLATFORM_DAILY_CAP — a conservative rolling-24h submission cap per
 *     account, checked BEFORE we call Blotato. At the cap we DEFER (leave the
 *     platform retryable for a later tick / the next day) instead of firing a
 *     doomed submission that returns `failed`. Set below the real provider
 *     limit to leave headroom for the other pipelines (music, quote-loop) that
 *     share the same accounts and that this app can't see.
 *  2. isTransientPublishError — recognizes rate/quota errors so the publisher
 *     keeps them retryable and suppresses the false "permanent failure" alert.
 */

/**
 * Rolling-24h submission cap per account, per platform. Absent = uncapped.
 *
 * - youtube: provider hard limit is 10 uploads / 24h / channel. Cap at 8 to
 *   leave room for the quote-loop / music pipelines that post to shared
 *   channels outside this app's accounting.
 * - tiktok: the Content Posting API blocks "too many posts via OpenAPI in the
 *   last 24h"; observed effective ceiling ~10. Cap at 8 for the same headroom.
 *
 * instagram/threads/twitter are intentionally uncapped here — their failures in
 * the incident were transient 429 bursts (handled by isTransientPublishError +
 * the existing per-platform throttle), not a daily-quota wall.
 */
export const PLATFORM_DAILY_CAP: Readonly<Record<string, number>> = {
    youtube: 8,
    tiktok: 8,
};

/** The rolling window the caps are measured over (hours). */
export const DAILY_CAP_WINDOW_HOURS = 24;

/**
 * True if submitting one more post to `accountId` on `platform` would risk the
 * provider's rolling-24h cap, given how many we've already put through in the
 * window. `recentCount` is successful+in-flight submissions (published/pending)
 * — failed attempts don't consume the provider quota, so they aren't counted.
 * Platforms with no cap always return false.
 */
export function isAccountAtDailyCap(platform: string, recentCount: number): boolean {
    const cap = PLATFORM_DAILY_CAP[platform];
    if (cap === undefined) return false;
    return recentCount >= cap;
}

/**
 * True if a publish error is a transient rate/quota limit rather than a
 * permanent problem (revoked token, deleted account, malformed caption).
 * Transient failures must stay retryable and must NOT trip the failure alert —
 * they clear on their own once the provider's rolling window drains.
 *
 * Matches the real messages seen from Blotato:
 *  - "You have reached the maximum number of 10 posts for the last 24 hours…"
 *  - "…too many posts via OpenAPI in the last 24 hours…"
 *  - "Blotato API error (429): … Rate limit exceeded, retry in 23 seconds"
 */
export function isTransientPublishError(message: string | null | undefined): boolean {
    if (!message) return false;
    return /\b429\b|rate.?limit|too many posts|maximum number of \d+ posts|reached the maximum|try again later|quota exceeded|too many requests/i.test(
        message,
    );
}
