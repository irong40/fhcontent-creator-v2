/**
 * The attribution line under a Freedom Voices quote: "— {speaker}, {source}, {year}".
 *
 * Why it exists: topic point sources usually open with the speaker's name ("Martin Luther King,
 * "Poverty and the World House," statement, 1967"), and the line put the speaker in front of the
 * source every time, so the script printed "— Martin Luther King, Martin Luther King, ...".
 * The source gate saw it in all three scripts it read on 2026-11-24. The speaker is named once:
 * if the source already attributes the quote to them, the source stands as written.
 *
 * A source that only MENTIONS the speaker does not attribute the quote to them. A name inside a
 * book title ("Scenes in the Life of Harriet Tubman by Sarah Bradford", "Medgar Evers: Mississippi
 * Martyr by ...") or as a recipient ("Letter to Martin Luther King from X") would credit someone
 * else if the speaker were dropped (qcheck r1 F1, 2026-11-24). So the source counts as naming the
 * speaker only when it opens with the name, the name follows "by", or the name stands as its own
 * comma field, and the name is not followed by ":" (a book title).
 */

const HONORIFICS = new Set(['dr', 'rev', 'reverend', 'jr', 'sr', 'mr', 'mrs', 'ms', 'miss']);

/**
 * Lower-case word tokens for matching. Accents are folded (Aimé = Aime), "&" reads "and",
 * possessive "'s" is dropped (King's = King), honorifics are dropped (Dr. ... Jr. = ...),
 * runs of single letters join (W.E.B. = WEB), and ":" stays as its own token so a title can be seen.
 */
export function nameTokens(s: string): string[] {
    const flat = s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[\u2018\u2019\u02bc`]/g, "'")
        .replace(/'s\b/g, '')
        .replace(/'/g, '')
        .replace(/:/g, ' : ')
        .replace(/[^a-z0-9: ]+/g, ' ');
    const raw = flat.split(/\s+/).filter(t => t && !HONORIFICS.has(t));
    const out: string[] = [];
    let initials = false; // the last token is a run of single letters
    for (const t of raw) {
        const letter = t.length === 1 && /[a-z]/.test(t);
        if (letter && initials) {
            out[out.length - 1] += t; // "w e b" -> "web", so initials match however they are dotted
        } else {
            out.push(t);
            initials = letter;
        }
    }
    return out;
}

/** Nouns for a record of the speaker's own words, so "<noun> of <name>" credits the quote to them. */
const SPOKEN_RECORD = new Set(['testimony', 'speech', 'address', 'remarks', 'statement', 'sermon', 'words']);

function startsAt(hay: string[], needle: string[], at: number): boolean {
    if (at + needle.length > hay.length) return false;
    for (let i = 0; i < needle.length; i++) if (hay[at + i] !== needle[i]) return false;
    return hay[at + needle.length] !== ':';
}

/** True when the source attributes the quote to the speaker (see the header for the rule). */
export function sourceNamesSpeaker(speaker: string, source: string): boolean {
    const name = nameTokens(speaker).filter(t => t !== ':');
    if (name.length === 0) return false;
    const fields = source.split(',').map(nameTokens);
    // 1. The source opens with the speaker ("Martin Luther King, ...", "King's Letter ...").
    if (fields[0] && startsAt(fields[0], name, 0)) return true;
    for (const f of fields) {
        // 2. The name stands as its own comma field (", Ella Baker,").
        if (f.length === name.length && startsAt(f, name, 0)) return true;
        // 3. The name follows "by" ("speech by Martin Luther King").
        for (let i = 0; i < f.length - 1; i++) {
            if (f[i] === 'by' && startsAt(f, name, i + 1)) return true;
            // 4. A spoken record "of" the speaker ("Testimony of Bob Moses"), live 5167b467.
            //    Not "Life of"/"Autobiography of": those are titles about the person.
            if (f[i] === 'of' && i > 0 && SPOKEN_RECORD.has(f[i - 1]) && startsAt(f, name, i + 1)) return true;
        }
    }
    return false;
}

export function quoteAttributionLine(speaker: string, source: string, year: string): string {
    const parts = sourceNamesSpeaker(speaker, source) ? [source, year] : [speaker, source, year];
    return `— ${parts.filter(p => p && p.trim()).join(', ')}`;
}

type QuotePoint = { claim?: unknown; source?: unknown; year?: unknown };

/**
 * The whole on-screen script of a quote video: the verbatim quote (topic point 1) and its
 * attribution line, speaker taken from the title before ":". Every writer of a quote script
 * (the cron generator, manual generate, regenerate, remix) stores this, so the speaker is named
 * once on every path (qcheck r1 F4, 2026-11-24). Null when the topic has no quote point to build from.
 */
export function quoteVideoScript(title: string, points: unknown): string | null {
    const quote = (Array.isArray(points) ? points[0] : undefined) as QuotePoint | undefined;
    const claim = typeof quote?.claim === 'string' ? quote.claim.trim() : '';
    if (!claim) return null;
    const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
    const speaker = title.split(':')[0].trim();
    return `${claim}\n\n${quoteAttributionLine(speaker, str(quote?.source), str(quote?.year))}`;
}
