import type { HistoricalPoint } from '@/types/database';

/**
 * Sourced-quote format (content_format 'sourced_quote').
 *
 * History Unveiled VA failed 15 of 15 source checks from 10-13 to 10-20 while its topics
 * passed: the standard format asks the writer for about a dozen pieces of free prose per
 * topic, and it added legacy lines, dropped hedges, changed verbs and invented numbers.
 * Freedom Voices passes with quote_video, where the script is the quote and its
 * attribution and nothing else. This format does the same for a sourced persona: one
 * piece per point, each the point's source passage in the source's own words, then the
 * Dictionary of Virginia Biography. The script is assembled here, never by a model.
 */
export const DVB_ATTRIBUTION = 'Dictionary of Virginia Biography';

/** Words that mark the source as unsure. Dropping one turns a hedge into a claim. */
const HEDGES = [
    'possibly', 'perhaps', 'probably', 'likely', 'apparently', 'reportedly', 'may have',
    'might have', 'about', 'nearly', 'approximately', 'around', 'some', 'temporary',
    'acting', 'allegedly', 'seems', 'appears',
];

export interface SourcedQuotePiece {
    pieceType: 'sourced_quote';
    point: number;
    script: string;
}

function norm(s: string): string {
    return s
        .replace(/[‘’]/g, "'")
        .replace(/[“”"]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function words(s: string): string[] {
    return norm(s).match(/[a-z0-9']+/g) ?? [];
}

function numbers(s: string): string[] {
    return s.replace(/,(?=\d{3}\b)/g, '').match(/\d+(?:\.\d+)?/g) ?? [];
}

/** One piece per point that carries a source passage. Points without one are skipped. */
export function buildSourcedQuotePieces(points: HistoricalPoint[]): SourcedQuotePiece[] {
    return points
        .filter(p => (p.quote ?? '').trim().length > 0)
        .map(p => ({
            pieceType: 'sourced_quote' as const,
            point: p.point,
            script: `“${p.quote!.trim()}”\n\n— ${DVB_ATTRIBUTION}`,
        }));
}

/**
 * Faults in a sourced-quote script, checked against the topic's points. Empty means it
 * passes. The body (everything before the attribution line) must be one point's passage
 * with nothing added, no hedge dropped, no word changed and no number the points lack.
 */
export function sourcedQuoteScriptFaults(points: HistoricalPoint[], script: string): string[] {
    const faults: string[] = [];
    const lines = script.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const attribution = lines.length > 1 ? lines[lines.length - 1] : '';
    const body = lines.slice(0, attribution ? -1 : undefined).join(' ');

    if (!/^[—-]/.test(attribution) || !attribution.includes(DVB_ATTRIBUTION)) {
        faults.push(`last line must be the attribution "— ${DVB_ATTRIBUTION}"`);
    }

    const passages = points.map(p => (p.quote ?? '').trim()).filter(Boolean);
    const bodyN = norm(body);
    const match = passages.find(q => norm(q) === bodyN);
    if (!match) {
        const best = passages.find(q => norm(q).includes(bodyN) || bodyN.includes(norm(q)));
        if (best && bodyN.includes(norm(best)) && bodyN.length > norm(best).length) {
            faults.push('adds words the source passage does not have');
        } else if (best) {
            faults.push('cuts the source passage');
        } else {
            faults.push('is not a source passage word for word');
        }
        const against = best ?? passages.join(' ');
        const have = new Set(words(against));
        const changed = [...new Set(words(body).filter(w => !have.has(w)))];
        if (changed.length) faults.push(`uses words not in the source passage: ${changed.join(', ')}`);
        const againstN = ` ${words(against).join(' ')} `;
        const bodyW = ` ${words(body).join(' ')} `;
        const dropped = HEDGES.filter(h => againstN.includes(` ${h} `) && !bodyW.includes(` ${h} `));
        if (dropped.length) faults.push(`drops the source's hedge: ${dropped.join(', ')}`);
    }

    const known = new Set(points.flatMap(p => numbers(`${p.claim} ${p.quote ?? ''} ${p.year}`)));
    const strange = [...new Set(numbers(body).filter(n => !known.has(n)))];
    if (strange.length) faults.push(`has numbers not in the points: ${strange.join(', ')}`);

    return faults;
}
