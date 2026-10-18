import { describe, expect, it } from 'vitest';
import { quotedSpans, unsourcedQuotes, sourcedQuoteFaults, rejectedSpans, closestSourceSentence, unquoteUnsourced } from './quote-check';

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
});
