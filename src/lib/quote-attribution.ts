/**
 * The attribution line under a Freedom Voices quote: "— {speaker}, {source}, {year}".
 *
 * Why it exists: topic point sources usually open with the speaker's name ("Martin Luther King,
 * "Poverty and the World House," statement, 1967"), and the line put the speaker in front of the
 * source every time, so the script printed "— Martin Luther King, Martin Luther King, ...".
 * The source gate saw it in all three scripts it read on 2026-11-24. The speaker is named once:
 * if the source already names them, the source stands as written.
 */

function words(s: string): string {
    return s
        .toLowerCase()
        .replace(/[‘’ʼ`]/g, "'")
        .replace(/[^a-z0-9' ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** True when the source text already names the speaker (whole-word match, case and punctuation ignored). */
export function sourceNamesSpeaker(speaker: string, source: string): boolean {
    const name = words(speaker);
    if (!name) return false;
    return ` ${words(source)} `.includes(` ${name} `);
}

export function quoteAttributionLine(speaker: string, source: string, year: string): string {
    const parts = sourceNamesSpeaker(speaker, source) ? [source, year] : [speaker, source, year];
    return `— ${parts.filter(p => p && p.trim()).join(', ')}`;
}
