import { describe, expect, it } from 'vitest';
import { claimJudgePrompt, hasSourcePassages, parseClaimVerdict, unsupportedSpecifics } from './claim-check';

// The 2026-10-18 Lafayette point and the pieces that contradicted it.
const lafayette = [{
    claim: 'James was a double agent who pretended to spy on the American army on behalf of the British but repeated to Lafayette the conversations he overheard.',
    quote: 'James was a double agent who pretended to spy on the American army on behalf of the British but repeated to Lafayette the conversations he overheard waiting tables at the headquarters of General Charles Cornwallis in Yorktown.',
}, { claim: 'He was freed by act in 1786.', quote: 'the House of Delegates passed an act freeing him from slavery on 25 December 1786' }];
const bad = [{ pieceType: 'short_1', script: 'James Lafayette was a double agent for the British in 1781.', captionShort: 'Freed in 1786.' }];

describe('unsupportedSpecifics', () => {
    it('flags a year or number no passage holds', () => {
        expect(unsupportedSpecifics(lafayette, bad)).toEqual(['short_1 script states "1781", which no source passage holds']);
    });
    it('reads carousel slides', () => {
        expect(unsupportedSpecifics(lafayette, [{ pieceType: 'carousel', carouselSlides: [{ text: 'In 1799 he left.' }] }])).toHaveLength(1);
    });
    it('does not check a topic with no source passages', () => {
        expect(unsupportedSpecifics([{ claim: 'x', quote: null }], bad)).toEqual([]);
        expect(hasSourcePassages([{ claim: 'x', quote: null }])).toBe(false);
    });
});

describe('claim judge', () => {
    it('puts every passage and every text field in the prompt, and bars outside knowledge', () => {
        const p = claimJudgePrompt(lafayette, bad);
        expect(p.user).toContain('[1] James was a double agent who pretended');
        expect(p.user).toContain('(short_1 script) James Lafayette was a double agent for the British');
        expect(p.system).toContain('Never use outside knowledge');
    });
    it('turns a verdict into faults', () => {
        expect(parseClaimVerdict('```json\n{"unsupported":[{"claim":"double agent for the British","reason":"he only pretended"}]}\n```'))
            .toEqual(['"double agent for the British" - he only pretended']);
        expect(parseClaimVerdict('{"unsupported":[]}')).toEqual([]);
    });
    it('fails closed when the reply is not a verdict', () => {
        expect(() => parseClaimVerdict('Looks fine to me')).toThrow('Unsupported claim');
        expect(() => parseClaimVerdict(JSON.stringify({ pieces: [] }))).toThrow('no verdict');
    });
});
