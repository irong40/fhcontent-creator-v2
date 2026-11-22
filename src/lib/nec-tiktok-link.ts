/**
 * NorthEast Corner TikTok post-to-piece link.
 *
 * NEC clips never enter content_pieces. Their publishing log is the NEC loader
 * ledger (operations/necorner-batch-2026-09-30/ledger.json), one entry per clip
 * (id NEC-Bxx-yy = the piece key). The ledger holds Blotato's submission UUID;
 * GET /v2/posts/{uuid} returns the live TikTok URL. Analytics rows carry the
 * TikTok URL from Blotato's analytics feed. The only join is the TikTok video
 * id in those two URLs (normalized URL second).
 *
 * Never a match key: caption/title text, any time field, view counts, Blotato
 * scheduleId, post order or a clip filename. Diagnosis:
 * obsidian-dev/agent-office/reports/nec-tiktok-piece-link-diagnosis.md
 */

export const NEC_TIKTOK_HANDLE = '@northeastcorner1';

/** TikTok video id (the 15-20 digit number after /video/), or null. */
export function tiktokVideoId(url: string | null | undefined): string | null {
    if (!url) return null;
    const m = url.match(/tiktok\.com\/@[^/?#]+\/video\/(\d{15,20})(?:[/?#]|$)/i);
    return m ? m[1] : null;
}

/** https://www.tiktok.com/@handle/video/<id>, lower-case handle, no query. */
export function normalizeTikTokUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const m = url.match(/tiktok\.com\/@([^/?#]+)\/video\/([^/?#]+)/i);
    if (!m) return null;
    return `https://www.tiktok.com/@${m[1].toLowerCase()}/video/${m[2]}`;
}

export interface LedgerClip {
    clipId: string;              // ledger entry id, e.g. NEC-B20-07 (the piece key)
    submissionId: string | null; // tiktok.response.postSubmissionId
    publicUrl: string | null;    // resolved from GET /v2/posts/{submissionId}
}

/** Pull clip id and TikTok submission id from ledger.json (array or {entries}). */
export function readLedgerClips(ledger: unknown): LedgerClip[] {
    const list: unknown[] = Array.isArray(ledger)
        ? ledger
        : Array.isArray((ledger as { entries?: unknown[] })?.entries)
            ? (ledger as { entries: unknown[] }).entries
            : [];
    const out: LedgerClip[] = [];
    for (const raw of list) {
        const e = raw as { id?: unknown; tiktok?: { response?: { postSubmissionId?: unknown }; publicUrl?: unknown } };
        if (typeof e?.id !== 'string') continue;
        const sub = e.tiktok?.response?.postSubmissionId;
        const pub = e.tiktok?.publicUrl;
        out.push({
            clipId: e.id,
            submissionId: typeof sub === 'string' && sub.length > 0 ? sub : null,
            publicUrl: typeof pub === 'string' && pub.length > 0 ? pub : null,
        });
    }
    return out;
}

/** Fill publicUrl for clips that have a submission id, via a Blotato status
 *  getter (read only). Failures leave publicUrl null and are counted. */
export async function resolveLedgerPublicUrls(
    clips: LedgerClip[],
    getStatus: (submissionId: string) => Promise<{ publicUrl?: string | null; postUrl?: string | null }>,
): Promise<{ clips: LedgerClip[]; errors: Array<{ clipId: string; error: string }> }> {
    const errors: Array<{ clipId: string; error: string }> = [];
    const outClips: LedgerClip[] = [];
    for (const c of clips) {
        if (c.publicUrl || !c.submissionId) { outClips.push(c); continue; }
        try {
            const s = await getStatus(c.submissionId);
            const url = s.publicUrl ?? s.postUrl ?? null;
            outClips.push({ ...c, publicUrl: typeof url === 'string' && url.length > 0 ? url : null });
        } catch (e) {
            errors.push({ clipId: c.clipId, error: (e as Error).message });
            outClips.push(c);
        }
    }
    return { clips: outClips, errors };
}

export interface NecLinkIndex {
    byVideoId: Map<string, string[]>; // video id -> clip ids
    byUrl: Map<string, string[]>;     // normalized URL -> clip ids
}

export function buildNecLinkIndex(clips: LedgerClip[]): NecLinkIndex {
    const byVideoId = new Map<string, string[]>();
    const byUrl = new Map<string, string[]>();
    const add = (m: Map<string, string[]>, k: string, clip: string) => {
        const cur = m.get(k) ?? [];
        if (!cur.includes(clip)) cur.push(clip);
        m.set(k, cur);
    };
    for (const c of clips) {
        const vid = tiktokVideoId(c.publicUrl);
        if (vid) add(byVideoId, vid, c.clipId);
        const url = normalizeTikTokUrl(c.publicUrl);
        if (url) add(byUrl, url, c.clipId);
    }
    return { byVideoId, byUrl };
}

export type NecLinkResult =
    | { status: 'linked'; pieceKey: string; via: 'video_id' | 'url'; videoId: string | null }
    | { status: 'unlinked'; reason: string; videoId: string | null }
    | { status: 'refused'; reason: string; candidates: string[]; videoId: string | null };

/** Match one analytics post to one ledger clip. Video id first, normalized URL
 *  second. More than one ledger clip for a post is refused, never guessed. */
export function matchNecPost(
    post: { videoId?: string | null; url?: string | null },
    index: NecLinkIndex,
): NecLinkResult {
    const videoId = post.videoId && /^\d{15,20}$/.test(post.videoId) ? post.videoId : tiktokVideoId(post.url);
    if (videoId) {
        const hits = index.byVideoId.get(videoId) ?? [];
        if (hits.length === 1) return { status: 'linked', pieceKey: hits[0], via: 'video_id', videoId };
        if (hits.length > 1) {
            return { status: 'refused', reason: `${hits.length} ledger entries resolve to TikTok video ${videoId}`, candidates: [...hits], videoId };
        }
        return { status: 'unlinked', reason: `no ledger entry resolves to TikTok video ${videoId}`, videoId };
    }
    const url = normalizeTikTokUrl(post.url);
    if (url) {
        const hits = index.byUrl.get(url) ?? [];
        if (hits.length === 1) return { status: 'linked', pieceKey: hits[0], via: 'url', videoId: null };
        if (hits.length > 1) {
            return { status: 'refused', reason: `${hits.length} ledger entries resolve to ${url}`, candidates: [...hits], videoId: null };
        }
        return { status: 'unlinked', reason: `no ledger entry resolves to ${url}`, videoId: null };
    }
    return { status: 'unlinked', reason: 'post has no TikTok video id or URL to match on', videoId: null };
}
