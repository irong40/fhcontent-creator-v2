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

// ---- Cited work titles ----------------------------------------------------------------------
// 2026-10-22: the Farmer and Forman rewrites were rejected three times each for quoting the
// essay they come from ("The New Jacobins and Full Emancipation," / "Control, Conflict, and
// Change,"). Those are titles, not words put in anyone's mouth. A quoted span that is written
// in title case AND appears in a point's source line (the citation) is read as a title.

const MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'via', 'from', 'with', 'into', 'over', 'than']);

/** Lowercase letters, digits and single spaces only, so "Control, Conflict, and Change," and
 *  "Control, Conflict and Change" compare equal. */
function looseNormalize(s: string): string {
    return s.toLowerCase().replace(/[‘’ʼ`']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** True when every word that is not a minor word starts with a capital (or a digit), and so
 *  does the first word: "Control, Conflict, and Change", "The World House". */
export function isTitleCase(span: string): boolean {
    const words = span.replace(/[^\p{L}\p{N}'’\s-]/gu, ' ').split(/[\s-]+/).filter(Boolean);
    if (words.length === 0) return false;
    return words.every((w, i) => {
        if (i > 0 && MINOR_WORDS.has(w.toLowerCase())) return true;
        return /^[\p{Lu}\p{N}]/u.test(w);
    });
}

/** True when `span` is a work title cited in one of `citations` (the points' source lines). */
export function isCitedTitle(span: string, citations: string[]): boolean {
    const n = looseNormalize(span);
    if (!n || !isTitleCase(span)) return false;
    return citations.some(c => ` ${looseNormalize(c)} `.includes(` ${n} `));
}

/** The quoted spans in `text` that appear in none of `sources`. Empty means clean. A span that
 *  is a work title cited in `citations` is a title, not a quotation, and is not flagged. */
export function unsourcedQuotes(text: string | null | undefined, sources: string[], citations: string[] = []): string[] {
    if (!text) return [];
    const haystack = sources.map(normalize);
    return quotedSpans(text).filter(span => {
        const n = normalize(span);
        return n.length > 0 && !haystack.some(h => h.includes(n)) && !isCitedTitle(span, citations);
    });
}

export const UNSOURCED_QUOTE_ERROR = 'Unsourced quotation';

/** Quoted spans in a sourced topic's pieces that no point or source passage holds. A topic
 *  with no source passages (an unsourced persona) is not checked. */
export function sourcedQuoteFaults(points: Array<{ claim?: string | null; quote?: string | null; source?: string | null }> | null | undefined, pieces: Array<Record<string, unknown>>): string[] {
    const list = Array.isArray(points) ? points : [];
    if (!list.some(p => typeof p?.quote === 'string' && p.quote.trim())) return [];
    const sources = list.flatMap(p => [p.claim, p.quote ?? '']).filter((t): t is string => typeof t === 'string' && t.length > 0);
    const citations = list.map(p => p.source).filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    const faults: string[] = [];
    for (const piece of pieces) {
        for (const field of ['script', 'captionLong', 'captionShort', 'title']) {
            for (const span of unsourcedQuotes(piece[field] as string | undefined, sources, citations)) {
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
    // 2026-10-22: this used indexOf(span) once per span. A caption that quoted the same title
    // twice had its FIRST, already-unquoted copy cut again ("In “X,” Farmer" became "InX,Farmer")
    // and its second copy left in quotation marks, so the retry failed the same way. Now every
    // occurrence that really sits between quotation marks is unquoted, and nothing else.
    const OPEN = new Set(['"', '“', '\'', '‘']);
    const CLOSE = new Set(['"', '”', '\'', '’']);
    let out = text;
    for (const span of new Set(unsourcedQuotes(text, sources))) {
        let from = 0;
        for (;;) {
            const at = out.indexOf(span, from);
            if (at < 0) break;
            let open = at - 1;
            while (open >= 0 && out[open] === ' ') open--;
            let close = at + span.length;
            while (close < out.length && out[close] === ' ') close++;
            if (open >= 0 && close < out.length && OPEN.has(out[open]) && CLOSE.has(out[close])) {
                out = out.slice(0, open) + span + out.slice(close + 1);
                from = open + span.length;
            } else {
                from = at + 1;
            }
        }
    }
    return out;
}
