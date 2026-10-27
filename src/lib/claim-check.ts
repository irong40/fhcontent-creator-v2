/**
 * Claim-support check for sourced text. quote-check.ts only proves that words in quotation
 * marks are word for word in a source. It cannot see a claim that goes beyond or contradicts
 * the source. 2026-10-18 the regenerated Lafayette text said he was a double agent "for the
 * British" (the source: he pretended to spy for them and reported to Lafayette) and the
 * Barrett text said she "threatened" to move the school (the source: she "promised" to move
 * it if it bothered the neighbors). No quotation marks, so the quote check passed both.
 *
 * Two layers. Specifics (years and numbers) are checked in code. Every other assertion goes
 * to a judge model that may flag only what the points contradict or do not hold. The judge sees
 * ONE piece at a time with the topic's numbered passages (2026-10-18: given all six pieces at
 * once it missed "threatened" in the long script; on one piece it caught it). A topic fails if
 * any piece fails. The judge's answer fails closed: anything that is not a parseable verdict
 * rejects the draft.
 */

import { createHash } from 'node:crypto';
import { getOrEnqueueLocalInference } from '@/lib/local-inference-queue';

type Point = { claim?: string | null; quote?: string | null; source?: string | null; year?: string | number | null };
type Piece = Record<string, unknown>;
/** The topic's own fields a specific may also come from (2026-10-22: the quote video's on-screen
 *  credit line is built from the title's figure name and point 1's source line and year). */
type TopicFields = { title?: string | null };

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

// ---- Specifics (years and numbers) --------------------------------------------------------
// 2026-10-22: the first version read digits only from each point's claim and quote, so it
// rejected numbers the topic does hold: "1967" on the quote video's own credit line (built
// from point 1's source line and year), "87" where the passage says "eighty-seven", "1880s"
// where the passage gives 1881-1882, "19th century" where every year is 1875-1895. A number
// is now held when any passage, source line, year or the topic title holds it, in digits or
// in words, or when it names a decade or century one of those years falls in. A number found
// nowhere is still rejected.

const UNITS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINAL_UNITS: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const ORDINAL_TENS: Record<string, number> = { twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60, seventieth: 70, eightieth: 80, ninetieth: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };
const ORDINAL_SCALES: Record<string, number> = { hundredth: 100, thousandth: 1_000, millionth: 1_000_000 };

const PROSE_WORDS = new Set(['one', 'first', 'second']);

/** The value of one number word ("eighty", "seventh"), or null. Hyphenated parts are split first. */
function smallWord(w: string): number | null {
    return UNITS[w] ?? TENS[w] ?? ORDINAL_UNITS[w] ?? ORDINAL_TENS[w] ?? null;
}

/** Numbers written in words ("eighty-seven", "Nineteenth", "one hundredth", "three billion"),
 *  as digit strings. A run ending in a scale word also yields its count ("three billion" -> 3),
 *  since "$3 billion" puts only the 3 in digits. */
export function wordNumbers(text: string): string[] {
    const out: string[] = [];
    // Hyphenated words are read part by part: "eighty-seven" is 80 then 7, "five-year" is 5.
    // Sentence punctuation is kept as a token so a run stops there: "twenty. Seven" is 20 and 7,
    // not 27 (Codex C5, 2026-10-27).
    const tokens = text.toLowerCase().match(/[a-z]+|[.!?;]/g) ?? [];
    let total = 0, current = 0, count: number | null = null, inRun = false;
    let runTokens: string[] = [];
    const flush = () => {
        // A lone "one", "first" or "second" is ordinary prose ("one of the", "the second time"),
        // not a stated number: it must not make 1 or 2 count as held (qcheck Q6).
        const prose = runTokens.length === 1 && PROSE_WORDS.has(runTokens[0]);
        if (inRun && !prose) {
            out.push(String(total + current));
            if (count !== null) out.push(String(count));
        }
        total = 0; current = 0; count = null; inRun = false; runTokens = [];
    };
    for (const token of tokens) {
        const v = smallWord(token);
        if (v !== null) {
            // A word joins the run only where English joins it: a unit after a bare ten
            // ("eighty seven"), or anything under 100 after a hundred ("one hundred fifty").
            // "one two" is two numbers, not three.
            const joins = inRun && (
                (current === 0 && total > 0) // after a thousand, million or billion
                || (current % 100 >= 20 && current % 10 === 0 && v < 10)
                || (current % 100 === 0 && current > 0 && v < 100));
            if (inRun && !joins) flush();
            current += v;
            inRun = true;
            runTokens.push(token);
            continue;
        }
        const scale = SCALES[token] ?? ORDINAL_SCALES[token];
        if (scale !== undefined) {
            const base = inRun ? current || 1 : 1;
            if (scale >= 1_000) { count = base; total += base * scale; current = 0; } else { current = base * scale; }
            inRun = true;
            runTokens.push(token);
            continue;
        }
        if (inRun && token === 'and') continue; // "one hundred and fifty"
        flush();
    }
    flush();
    return out;
}

const NUMBER_RE = /\d[\d,.]*\d|\d/g;
const clean = (n: string) => n.replace(/,/g, '');

/** Every number the topic holds (digits and words) and the full years among them. */
function heldNumbers(texts: string[]): { held: Set<string>; years: number[] } {
    const held = new Set<string>();
    for (const t of texts) {
        for (const n of t.match(NUMBER_RE) ?? []) held.add(clean(n));
        for (const n of wordNumbers(t)) held.add(n);
        // The end year of an abbreviated range ("1881-82" holds 1882), read the same way as the
        // generated text, so an exact copy of the source passes (Codex C4, 2026-10-27).
        for (const s of specificsIn(t)) held.add(s.value);
    }
    // Only a plain four-digit number written as a year (no comma, so not a head count like
    // "1,500", and not a number read from words) opens a decade or century range (qcheck Q6).
    const years = texts.flatMap(t => t.match(/(?<![\d,.])\d{4}(?![\d,]|\.\d)/g) ?? []).map(Number).filter(n => n >= 1000 && n <= 2100);
    return { held, years };
}

type Specific = { shown: string; value: string; range?: [number, number] };

/** The numbers a text states, read with what follows them: a decade ("1880s"), a century
 *  ("19th century", "early 1900s") or a year range ("1881-82", whose end year is 1882). */
function specificsIn(text: string): Specific[] {
    const out: Specific[] = [];
    const re = /\d[\d,.]*\d|\d/g;
    for (const m of text.matchAll(re)) {
        const shown = m[0];
        const value = clean(shown);
        const after = text.slice(m.index + shown.length, m.index + shown.length + 16);
        const before = text.slice(Math.max(0, m.index - 6), m.index);
        const n = Number(value);
        // Decade or century: "1880s", "1900s".
        if (/^'?s\b/.test(after) && /^\d{3}0$/.test(value)) {
            const span: [number, number] = value.endsWith('00') ? [n, n + 99] : [n, n + 9];
            out.push({ shown: `${shown}s`, value, range: span });
            continue;
        }
        // Century by ordinal: "19th century", "20th-century".
        if (/^(st|nd|rd|th)[\s-]+centur(y|ies)\b/i.test(after) && n >= 1 && n <= 21) {
            out.push({ shown: `${shown}${after.match(/^(st|nd|rd|th)/i)![0]} century`, value, range: [(n - 1) * 100 + 1, n * 100] });
            continue;
        }
        // End of an abbreviated year range: the "82" of "1881-82" is the year 1882.
        const start = before.match(/(\d{4})\s*[-–—]\s*$/);
        if (start && /^\d{2}$/.test(value)) {
            out.push({ shown, value: `${start[1].slice(0, 2)}${value}` });
            continue;
        }
        out.push({ shown, value });
    }
    return out;
}

/** Years and numbers in a piece that no point, source line, year or topic title holds. */
export function unsupportedSpecifics(points: Point[] | null | undefined, pieces: Piece[], topic: TopicFields = {}): string[] {
    const sources = sourcesOf(points);
    if (!sources) return [];
    const list = Array.isArray(points) ? points : [];
    const texts = [
        ...sources,
        ...list.flatMap(p => [p.source ?? '', p.year == null ? '' : String(p.year)]),
        topic.title ?? '',
    ].filter(t => t.length > 0);
    const { held, years } = heldNumbers(texts);
    const faults: string[] = [];
    for (const piece of pieces) {
        for (const [field, text] of textFields(piece)) {
            const seen = new Set<string>();
            for (const s of specificsIn(text)) {
                const ok = held.has(s.value) || (s.range !== undefined && years.some(y => y >= s.range![0] && y <= s.range![1]));
                if (ok || seen.has(s.shown)) continue;
                seen.add(s.shown);
                faults.push(`${String(piece.pieceType)} ${field} states "${s.shown}", which no source passage holds`);
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

export type JudgeCall = (system: string, user: string) => Promise<string>;

/** Judge model and endpoint. 127.0.0.1, not localhost: localhost can resolve to an empty ::1 server. */
export function claimJudgeConfig(env: Record<string, string | undefined> = process.env) {
    return {
        model: env.CLAIM_JUDGE_MODEL?.trim() || 'qwen3:32b',
        endpoint: (env.CLAIM_JUDGE_ENDPOINT?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    };
}

/**
 * The production judge call. The content-generator runs on Vercel, which cannot reach the
 * Ollama on 127.0.0.1, so the call goes through the same durable local-inference queue as the
 * drafts and the local worker answers it with qwen3:32b. Same prompt, same job: the key is the
 * prompt's hash, so a cron run that finds the job unfinished throws LocalInferencePendingError
 * and the next run picks the finished verdict up.
 */
export async function callJudge(system: string, user: string, trace?: { topicId: string; topicVersion: string }): Promise<string> {
    const requestKey = `claim:${createHash('sha256').update(system).update(':').update(user).digest('hex')}`;
    return (await getOrEnqueueLocalInference({ requestKey, system, user, maxTokens: 2048, schema: CLAIM_JUDGE_TOOL_SCHEMA, model: 'qwen3:32b', ...(trace ? { trace } : {}) })).text;
}

/**
 * One judge call straight to an Ollama this process can reach (scripts on the local machine
 * only, never the Vercel route), streamed. A non-streamed call sends no headers until the
 * model finishes, and undici cuts that off at 5 minutes; a stream sends headers at once.
 */
export async function callJudgeDirect(system: string, user: string, env: Record<string, string | undefined> = process.env): Promise<string> {
    const { model, endpoint } = claimJudgeConfig(env);
    const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            model, stream: true, think: false, format: 'json', options: { temperature: 0 },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
    });
    if (!response.ok || !response.body) throw new Error(`${UNSUPPORTED_CLAIM_ERROR}: the claim check could not reach the judge model (HTTP ${response.status})`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let done = false;
    const take = (line: string) => {
        if (!line.trim()) return;
        const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
        if (chunk.error) throw new Error(`${UNSUPPORTED_CLAIM_ERROR}: the judge model failed: ${chunk.error}`);
        text += chunk.message?.content ?? '';
        if (chunk.done) done = true;
    };
    for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(take);
    }
    take(buffer);
    if (!done) throw new Error(`${UNSUPPORTED_CLAIM_ERROR}: the judge stream ended before the model finished`);
    return text;
}

/** Judges each piece alone against the topic's passages. Returns every fault, labelled by piece; throws if any verdict is unreadable. */
export async function judgeClaims(points: Point[], pieces: Piece[], call: JudgeCall = callJudge): Promise<string[]> {
    // Every piece is asked at once, so a queued judge starts all of them in one cron run
    // instead of one piece per run. A job still waiting throws only after the rest are asked.
    const settled = await Promise.allSettled(pieces.map(piece => {
        const { system, user } = claimJudgePrompt(points, [piece]);
        return call(system, user);
    }));
    const failure = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected' && !(r.reason instanceof Error && r.reason.name === 'LocalInferencePendingError'))
        ?? settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;
    const faults: string[] = [];
    settled.forEach((r, i) => {
        for (const fault of parseClaimVerdict((r as PromiseFulfilledResult<string>).value)) faults.push(`${String(pieces[i].pieceType)}: ${fault}`);
    });
    return faults;
}
