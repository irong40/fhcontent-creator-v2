/**
 * Quotation check for sourced text. A span in quotation marks presents words as someone's
 * own. For a topic written from source passages, every such span must appear word for word
 * in a point or a passage.
 *
 * Why it exists: 2026-10-12 the first loop-sourced Freedom Voices text failed its source
 * check on one caption, "Fannie Lou Hamer's powerful words from 1964: 'I'm sick and tired of
 * being sick and tired.'" Those are the speech's published TITLE, not her words ("now I am
 * sick and tired of being sick and tired"). The prompt already forbade it; the model did it
 * anyway, and the 10-07 Hamer record failed the same way. This catches it before a text
 * reaches the source checker, so the writer tries again instead of a human finding it.
 */

const MIN_WORDS = 3; // shorter spans are names and terms ("Jim Crow"), not quotations

function normalize(s: string): string {
    return s
        .toLowerCase()
        .replace(/[‘’ʼ`]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/["]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.,;:!?'—–-]+|[\s.,;:!?'—–-]+$/g, '')
        .trim();
}

/** Every quoted span of at least MIN_WORDS words, in double or single quotation marks. */
export function quotedSpans(text: string): string[] {
    const spans: string[] = [];
    const double = /["“]([^"“”]+)["”]/g;
    // Single quotes: the opening mark follows a non-letter and the closing mark precedes one,
    // so apostrophes inside words (I'm, Hamer's) are kept inside the span.
    const single = /(?<![\p{L}\p{N}])['‘]((?:[^'‘’]|(?<=\p{L})['’](?=\p{L}))+?)['’](?![\p{L}\p{N}])/gu;
    for (const re of [double, single]) {
        for (const m of text.matchAll(re)) {
            const span = m[1].trim();
            if (span.split(/\s+/).filter(Boolean).length >= MIN_WORDS) spans.push(span);
        }
    }
    return spans;
}

/** The quoted spans in `text` that appear in none of `sources`. Empty means clean. */
export function unsourcedQuotes(text: string | null | undefined, sources: string[]): string[] {
    if (!text) return [];
    const haystack = sources.map(normalize);
    return quotedSpans(text).filter(span => {
        const n = normalize(span);
        return n.length > 0 && !haystack.some(h => h.includes(n));
    });
}

export const UNSOURCED_QUOTE_ERROR = 'Unsourced quotation';

/** Quoted spans in a sourced topic's pieces that no point or source passage holds. A topic
 *  with no source passages (an unsourced persona) is not checked. */
export function sourcedQuoteFaults(points: Array<{ claim?: string | null; quote?: string | null; source?: string | null }> | null | undefined, pieces: Array<Record<string, unknown>>): string[] {
    const list = Array.isArray(points) ? points : [];
    if (!list.some(p => typeof p?.quote === 'string' && p.quote.trim())) return [];
    // `source` is the cited page's title: a quoted title of a work (Forman, two King topics) is
    // sourced when it appears word for word there. The speaker's own words still need a passage.
    const sources = list.flatMap(p => [p.claim, p.quote ?? '', p.source ?? '']).filter((t): t is string => typeof t === 'string' && t.length > 0);
    const faults: string[] = [];
    for (const piece of pieces) {
        for (const field of ['script', 'captionLong', 'captionShort', 'title']) {
            for (const span of unsourcedQuotes(piece[field] as string | undefined, sources)) {
                faults.push(`${String(piece.pieceType)} ${field} quotes "${span}", which no source passage holds`);
            }
        }
    }
    return faults;
}

/** The rejected span named in a fault message ('... quotes "<span>", which no source ...'). */
export function rejectedSpans(errorMessage: string | null | undefined): string[] {
    if (!errorMessage) return [];
    return [...errorMessage.matchAll(/quotes "(.+?)", which no source/g)].map(m => m[1]);
}

/** The source sentence that shares the most words with `span`, copied exactly, or null when
 *  none shares at least half of them. A retry prompt that names this sentence gives the model
 *  words to copy; "copy exactly" alone did not stop a 8b model repeating a speech title. */
export function closestSourceSentence(span: string, sources: string[]): string | null {
    const words = new Set(normalize(span).split(' ').filter(Boolean));
    if (words.size === 0) return null;
    let best: { sentence: string; score: number } | null = null;
    for (const source of sources) {
        for (const raw of source.split(/(?<=[.!?])\s+|\n+/)) {
            const sentence = raw.trim();
            if (!sentence) continue;
            const have = new Set(normalize(sentence).split(' '));
            const score = [...words].filter(w => have.has(w)).length;
            if (!best || score > best.score) best = { sentence, score };
        }
    }
    return best && best.score >= words.size / 2 ? best.sentence : null;
}

/** `text` with the quotation marks removed from each unsourced span, so the words stay as
 *  description and stop claiming to be the speaker's. Used only after a retry has already
 *  been told to copy the source exactly and did not. */
export function unquoteUnsourced(text: string, sources: string[]): string {
    let out = text;
    for (const span of unsourcedQuotes(text, sources)) {
        const at = out.indexOf(span);
        if (at > 0 && at + span.length < out.length) {
            out = out.slice(0, at - 1) + span + out.slice(at + span.length + 1);
        }
    }
    return out;
}
