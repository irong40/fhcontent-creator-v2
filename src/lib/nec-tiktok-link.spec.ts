import { describe, it, expect } from 'vitest';
import {
    tiktokVideoId,
    normalizeTikTokUrl,
    readLedgerClips,
    resolveLedgerPublicUrls,
    buildNecLinkIndex,
    matchNecPost,
} from './nec-tiktok-link';

// Fixture rows only. No live ledger, Blotato or Supabase.
const V1 = '7663140126465281294';
const V2 = '7663140126465281295';
const V3 = '7663140126465281296';
const url = (id: string, q = '') => `https://www.tiktok.com/@NorthEastCorner1/video/${id}${q}`;

const ledger = {
    entries: [
        { id: 'NEC-B10-01', tiktok: { response: { postSubmissionId: 'sub-1' } } },
        { id: 'NEC-B10-02', tiktok: { response: { postSubmissionId: 'sub-2' } } },
        // two log entries that resolve to one post
        { id: 'NEC-B11-01', tiktok: { response: { postSubmissionId: 'sub-3a' } } },
        { id: 'NEC-B11-02', tiktok: { response: { postSubmissionId: 'sub-3b' } } },
        { id: 'NEC-B12-01', tiktok: { response: {} } },
    ],
};
const statuses: Record<string, string> = {
    'sub-1': url(V1, '?is_from_webapp=1'),
    'sub-2': url(V2),
    'sub-3a': url(V3),
    'sub-3b': url(V3),
};

async function index() {
    const clips = readLedgerClips(ledger);
    const { clips: resolved } = await resolveLedgerPublicUrls(clips, async (s) => ({ publicUrl: statuses[s] ?? null }));
    return buildNecLinkIndex(resolved);
}

describe('nec-tiktok-link', () => {
    it('reads the video id and normalized URL from a TikTok URL', () => {
        expect(tiktokVideoId(url(V1, '?lang=en'))).toBe(V1);
        expect(normalizeTikTokUrl(url(V1, '?lang=en'))).toBe(`https://www.tiktok.com/@northeastcorner1/video/${V1}`);
        expect(tiktokVideoId('https://www.tiktok.com/@northeastcorner1')).toBeNull();
    });

    it('links by post id (TikTok video id)', async () => {
        const r = matchNecPost({ videoId: V1, url: null }, await index());
        expect(r).toEqual({ status: 'linked', pieceKey: 'NEC-B10-01', via: 'video_id', videoId: V1 });
    });

    it('links by URL when the analytics row has only the post URL', async () => {
        const r = matchNecPost({ url: url(V2, '?share=1') }, await index());
        expect(r.status).toBe('linked');
        expect(r.status === 'linked' && r.pieceKey).toBe('NEC-B10-02');
    });

    it('links by normalized URL when no video id can be read', async () => {
        const idx = buildNecLinkIndex([{ clipId: 'NEC-B13-01', submissionId: 's', publicUrl: 'https://www.tiktok.com/@northeastcorner1/video/abc' }]);
        const r = matchNecPost({ url: 'https://tiktok.com/@NorthEastCorner1/video/abc?x=1' }, idx);
        expect(r).toEqual({ status: 'linked', pieceKey: 'NEC-B13-01', via: 'url', videoId: null });
    });

    it('leaves a post with no log entry unlinked, with a reason', async () => {
        const r = matchNecPost({ videoId: '7000000000000000001' }, await index());
        expect(r.status).toBe('unlinked');
        expect(r.status === 'unlinked' && r.reason).toMatch(/no ledger entry/);
    });

    it('refuses a post that two log entries resolve to, and does not guess', async () => {
        const r = matchNecPost({ videoId: V3 }, await index());
        expect(r.status).toBe('refused');
        expect(r.status === 'refused' && r.candidates.sort()).toEqual(['NEC-B11-01', 'NEC-B11-02']);
    });

    it('never matches without an id or URL (caption or time are not keys)', async () => {
        const r = matchNecPost({ videoId: null, url: null }, await index());
        expect(r.status).toBe('unlinked');
    });

    it('counts a failed Blotato lookup and leaves that clip unresolved', async () => {
        const clips = readLedgerClips(ledger);
        const { clips: out, errors } = await resolveLedgerPublicUrls(clips, async (s) => {
            if (s === 'sub-2') throw new Error('HTTP 500');
            return { publicUrl: statuses[s] ?? null };
        });
        expect(errors).toEqual([{ clipId: 'NEC-B10-02', error: 'HTTP 500' }]);
        expect(out.find((c) => c.clipId === 'NEC-B10-02')?.publicUrl).toBeNull();
        expect(out.find((c) => c.clipId === 'NEC-B12-01')?.submissionId).toBeNull();
    });
});
