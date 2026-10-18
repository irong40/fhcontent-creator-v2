/**
 * Claim-support check for sourced text. quote-check.ts only proves that words in quotation
 * marks are word for word in a source. It cannot see a claim that goes beyond or contradicts
 * the source. 2026-10-18 the regenerated Lafayette text said he was a double agent "for the
 * British" (the source: he pretended to spy for them and reported to Lafayette) and the
 * Barrett text said she "threatened" to move the school (the source: she "promised" to move
 * it if it bothered the neighbors). No quotation marks, so the quote check passed both.
 *
 * Two layers. Specifics (years and numbers) are checked in code. Every other assertion goes
 * to a judge model that may flag only what the points contradict or do not hold. The judge's
 * answer fails closed: anything that is not a parseable verdict rejects the draft.
 */

type Point = { claim?: string | null; quote?: string | null };
type Piece = Record<string, unknown>;

const FIELDS = ['script', 'captionLong', 'captionShort', 'title'];

export const UNSUPPORTED_CLAIM_ERROR = 'Unsupported claim';

export const CLAIM_JUDGE_TOOL_SCHEMA = {
    type: 'object',
    properties: {
        unsupported: {
            type: 'array',
            items: {
                type: 'object',
                properties: { claim: { type: 'string' }, reason: { type: 'string' } },
                required: ['claim', 'reason'],
            },
        },
    },
    required: ['unsupported'],
} as Record<string, unknown>;

function sourcesOf(points: Point[] | null | undefined): string[] | null {
    const list = Array.isArray(points) ? points : [];
    if (!list.some(p => typeof p?.quote === 'string' && p.quote.trim())) return null; // unsourced persona: not checked
    return list.flatMap(p => [p.claim, p.quote ?? '']).filter((t): t is string => typeof t === 'string' && t.length > 0);
}

function textFields(piece: Piece): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    for (const f of FIELDS) if (typeof piece[f] === 'string') out.push([f, piece[f] as string]);
    const slides = piece.carouselSlides;
    if (Array.isArray(slides)) slides.forEach((s, i) => { if (typeof s === 'string') out.push([`carouselSlides[${i}]`, s]); else if (s && typeof s === 'object') for (const v of Object.values(s)) if (typeof v === 'string') out.push([`carouselSlides[${i}]`, v]); });
    return out;
}

/** Years and numbers in a piece that no point or source passage holds. */
export function unsupportedSpecifics(points: Point[] | null | undefined, pieces: Piece[]): string[] {
    const sources = sourcesOf(points);
    if (!sources) return [];
    const held = new Set(sources.join(' ').match(/\d[\d,.]*\d|\d/g) ?? []);
    const faults: string[] = [];
    for (const piece of pieces) {
        for (const [field, text] of textFields(piece)) {
            for (const n of new Set(text.match(/\d[\d,.]*\d|\d/g) ?? [])) {
                if (!held.has(n)) faults.push(`${String(piece.pieceType)} ${field} states "${n}", which no source passage holds`);
            }
        }
    }
    return faults;
}

/** The prompt for the judge model. Points only: it must not use what it knows. */
export function claimJudgePrompt(points: Point[], pieces: Piece[]): { system: string; user: string } {
    const sources = (sourcesOf(points) ?? []).map((s, i) => `[${i + 1}] ${s}`).join('\n');
    const texts = pieces.flatMap(p => textFields(p).map(([f, t]) => `(${String(p.pieceType)} ${f}) ${t}`)).join('\n');
    return {
        system: 'You are a strict fact checker. You judge text ONLY against the numbered source passages. Never use outside knowledge. '
            + 'List every factual assertion in the text that a passage contradicts, reverses, overstates (for example "threatened" where a passage says "promised"), or does not state at all, including who did what for whom, causes, outcomes and significance. '
            + 'Opinion framing with no factual content is not a claim. If every assertion is held by a passage, return an empty list. Return JSON {"unsupported":[{"claim":"...","reason":"..."}]}.',
        user: `SOURCE PASSAGES:\n${sources}\n\nTEXT TO CHECK:\n${texts}`,
    };
}

/** Faults from the judge's reply. Anything that is not a verdict throws, so the draft is rejected. */
export function parseClaimVerdict(text: string): string[] {
    let data: unknown;
    try { data = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()); } catch { throw new Error(`${UNSUPPORTED_CLAIM_ERROR}: the claim check returned no verdict`); }
    const list = (data as { unsupported?: unknown })?.unsupported;
    if (!Array.isArray(list)) throw new Error(`${UNSUPPORTED_CLAIM_ERROR}: the claim check returned no verdict`);
    return list.map(i => {
        const o = (i ?? {}) as { claim?: unknown; reason?: unknown };
        return `"${String(o.claim ?? '').trim()}" - ${String(o.reason ?? '').trim()}`;
    });
}

/** True when the topic has source passages, so claims can be checked against them. */
export function hasSourcePassages(points: Point[] | null | undefined): boolean {
    return sourcesOf(points) !== null;
}
