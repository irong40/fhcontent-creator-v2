import { describe, expect, it } from 'vitest';
import { quotedSpans, unsourcedQuotes, sourcedQuoteFaults, rejectedSpans, closestSourceSentence, unquoteUnsourced, isCitedTitle, isTitleCase } from './quote-check';

// The real 2026-10-12 Hamer text (topic 5767ceaf), which failed its source check.
const passage = 'And you can always hear this long sob story: "You know it takes time." For three hundred years, we\'ve given them time. And I\'ve been tired so long, now I am sick and tired of being sick and tired, and we want a change.';
const failedCaption = "Fannie Lou Hamer’s powerful words from 1964: 'I’m sick and tired of being sick and tired.' A rallying cry for justice in the Civil Rights Movement. #CivilRightsMovement #FreedomVoices";

describe('quote check', () => {
    it('catches the title quoted as her words (the 10-12 FAIL)', () => {
        expect(unsourcedQuotes(failedCaption, [passage])).toEqual(['I’m sick and tired of being sick and tired.']);
    });

    it('passes words copied exactly from the passage, in any quotation marks', () => {
        expect(unsourcedQuotes('She said “now I am sick and tired of being sick and tired” in Harlem.', [passage])).toEqual([]);
        expect(unsourcedQuotes("She said 'we want a change' and meant it.", [passage])).toEqual([]);
        expect(unsourcedQuotes('"You know it takes time." For three hundred years', [passage])).toEqual([]);
    });

    it('keeps apostrophes inside a single-quoted span and ignores possessives', () => {
        expect(quotedSpans("Hamer's line: 'I've been tired so long' stuck.")).toEqual(["I've been tired so long"]);
        expect(quotedSpans("Hamer's speech and Malcolm X's rally")).toEqual([]);
    });

    it('ignores short quoted terms and empty text', () => {
        expect(unsourcedQuotes('the "Jim Crow" South', [passage])).toEqual([]);
        expect(unsourcedQuotes(null, [passage])).toEqual([]);
    });
});

describe('sourcedQuoteFaults', () => {
    const points = [{ claim: passage, quote: passage }, { claim: 'Hamer spoke in Harlem.', quote: 'Speech Delivered with Malcolm X at the Williams Institutional CME Church' }];
    it('names the piece and field of an unsourced quotation', () => {
        expect(sourcedQuoteFaults(points, [{ pieceType: 'quote_video', script: passage, captionShort: failedCaption }]))
            .toEqual(['quote_video captionShort quotes "I’m sick and tired of being sick and tired.", which no source passage holds']);
    });
    it('does not check a topic with no source passages', () => {
        expect(sourcedQuoteFaults([{ claim: 'x', quote: null }], [{ pieceType: 'long', captionShort: failedCaption }])).toEqual([]);
    });
    it('passes a quoted title that appears word for word in the cited page title', () => {
        const pts = [{ claim: 'King wrote from jail.', quote: 'Injustice anywhere is a threat to justice everywhere.', source: 'Letter from Birmingham Jail, April 16, 1963' }];
        expect(sourcedQuoteFaults(pts, [{ pieceType: 'long', captionShort: 'King wrote "Letter from Birmingham Jail" in 1963.' }])).toEqual([]);
    });
    it('still fails a quoted title that is not on the cited page', () => {
        const pts = [{ claim: 'King wrote from jail.', quote: 'Injustice anywhere is a threat to justice everywhere.', source: 'Letter from Birmingham Jail, April 16, 1963' }];
        expect(sourcedQuoteFaults(pts, [{ pieceType: 'long', captionShort: 'King wrote "Why We Cannot Wait Any Longer" in 1963.' }]))
            .toEqual(['long captionShort quotes "Why We Cannot Wait Any Longer", which no source passage holds']);
    });
});

// 2026-10-22: Farmer (cf172ba2) and Forman (a64abec8) were rejected three times each for
// quoting the essay title from their own source line. Points trimmed from the real topics.
describe('cited work titles (2026-10-22)', () => {
    const farmer = [{
        claim: 'This cannot be a sheer bootstrap operation.',
        quote: 'The responsibility of accelerating the Negro\'s march to equality does not rest with the Negro alone. This cannot be a sheer bootstrap operation.',
        source: 'James Farmer, The New Jacobins and Full Emancipation (1964), Civil Rights Movement Archive',
    }];
    const forman = [{
        claim: 'Conflict must be created around control mechanisms.',
        quote: 'we are quite confident that conflict must be created around control mechanisms. This is not passive action.',
        source: 'James Forman, Control, Conflict, and Change: Underlying Concepts of the Black Manifesto (1969), Civil Rights Movement Archive',
    }];

    it('passes a title-cased title from the source line (the exact rejected captions)', () => {
        expect(sourcedQuoteFaults(farmer, [{ pieceType: 'quote_video', captionLong: 'In his 1964 essay “The New Jacobins and Full Emancipation,” Farmer argued for help.' }])).toEqual([]);
        expect(sourcedQuoteFaults(forman, [{ pieceType: 'quote_video', captionLong: 'From "Control, Conflict, and Change," Forman’s 1969 essay.' }])).toEqual([]);
        // Commas and the Oxford comma do not matter, a part of a longer title still counts.
        expect(sourcedQuoteFaults(forman, [{ pieceType: 'quote_video', captionShort: '"Control, Conflict and Change" and the "Underlying Concepts of the Black Manifesto"' }])).toEqual([]);
    });

    it('passes any span the source line holds word for word, title-cased or not (8ff831f rule)', () => {
        expect(sourcedQuoteFaults(farmer, [{ pieceType: 'quote_video', captionLong: 'He wrote of "the new jacobins and full emancipation" as a cause.' }])).toEqual([]);
    });

    it('still flags speech that neither a passage nor the source line holds', () => {
        expect(sourcedQuoteFaults(farmer, [{ pieceType: 'quote_video', captionLong: 'He said "we must march on to freedom" that day.' }]))
            .toEqual(['quote_video captionLong quotes "we must march on to freedom", which no source passage holds']);
    });

    it('still flags a title-cased phrase the source line does not cite', () => {
        expect(sourcedQuoteFaults(farmer, [{ pieceType: 'quote_video', captionLong: 'Farmer’s essay “Freedom Now For Everyone” made the case.' }]))
            .toEqual(['quote_video captionLong quotes "Freedom Now For Everyone", which no source passage holds']);
    });

    it('reads a title only as a whole run of words in the citation, and only in title case', () => {
        expect(isCitedTitle('The World House', ['Martin Luther King, The World House, from Where Do We Go From Here: Chaos or Community? (1967)'])).toBe(true);
        expect(isCitedTitle('World Hous', ['Martin Luther King, The World House (1967)'])).toBe(false);
        expect(isCitedTitle('the world house', ['Martin Luther King, The World House (1967)'])).toBe(false);
        expect(isTitleCase('Where Do We Go From Here: Chaos or Community?')).toBe(true);
        expect(isTitleCase('This is not passive action')).toBe(false);
    });
});

describe('retry help', () => {
    const fault = 'quote_video captionShort quotes "I’m sick and tired of being sick and tired.", which no source passage holds';
    it('reads the rejected span back out of the fault message', () => {
        expect(rejectedSpans(`Unsourced quotation: ${fault}`)).toEqual(['I’m sick and tired of being sick and tired.']);
        expect(rejectedSpans(null)).toEqual([]);
    });
    it('finds the exact source sentence nearest the rejected span', () => {
        const s = closestSourceSentence('I’m sick and tired of being sick and tired.', [passage]);
        expect(s).toBe('And I\'ve been tired so long, now I am sick and tired of being sick and tired, and we want a change.');
        expect(unsourcedQuotes(`"${s}"`, [passage])).toEqual([]);
    });
    it('returns null when nothing in the sources resembles the span', () => {
        expect(closestSourceSentence('totally different words here', [passage])).toBeNull();
    });
});

describe('unquoteUnsourced', () => {
    it('drops the marks around a title quoted as speech and keeps sourced quotes', () => {
        const t = `Hamer: "I’m sick and tired of being sick and tired." She said "now I am sick and tired of being sick and tired".`;
        const out = unquoteUnsourced(t, [passage]);
        expect(out).toBe(`Hamer: I’m sick and tired of being sick and tired. She said "now I am sick and tired of being sick and tired".`);
        expect(unsourcedQuotes(out, [passage])).toEqual([]);
    });

    it('unquotes every copy of a repeated span and cuts nothing else (2026-10-22)', () => {
        // Before: "InThe New Jacobins and Full Emancipation,Farmer wrote. Read “The New ...,” today."
        const t = 'In “The New Jacobins and Full Emancipation,” Farmer wrote. Read “The New Jacobins and Full Emancipation,” today.';
        expect(unquoteUnsourced(t, ['nothing'])).toBe('In The New Jacobins and Full Emancipation, Farmer wrote. Read The New Jacobins and Full Emancipation, today.');
        // A copy that was never in quotation marks is left as it is.
        expect(unquoteUnsourced('The New Jacobins and Full Emancipation, then “The New Jacobins and Full Emancipation.”', ['nothing']))
            .toBe('The New Jacobins and Full Emancipation, then The New Jacobins and Full Emancipation.');
    });
});
