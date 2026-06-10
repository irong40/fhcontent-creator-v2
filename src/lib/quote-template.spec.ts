import { describe, it, expect } from 'vitest';
import { quoteFontSize, buildQuoteCardTree, QUOTE_CANVAS } from './quote-template';
import { countWords, QUOTE_MIN_WORDS, quoteContentResponseSchema } from './schemas';

describe('quoteFontSize', () => {
    it('uses the largest size for short quotes', () => {
        expect(quoteFontSize('a'.repeat(180))).toBe(64);
    });

    it('steps down as quotes get longer', () => {
        expect(quoteFontSize('a'.repeat(250))).toBe(56);
        expect(quoteFontSize('a'.repeat(320))).toBe(50);
        expect(quoteFontSize('a'.repeat(420))).toBe(44);
    });
});

describe('buildQuoteCardTree', () => {
    const card = {
        quote: 'If there is no struggle there is no progress.',
        attribution: 'Frederick Douglass',
        source: 'West India Emancipation speech',
        year: '1857',
        brandMark: 'Freedom Voices',
    };

    it('is a portrait 1080x1920 canvas', () => {
        const tree = buildQuoteCardTree(card) as { props: { style: { width: number; height: number } } };
        expect(tree.props.style.width).toBe(QUOTE_CANVAS.width);
        expect(tree.props.style.height).toBe(QUOTE_CANVAS.height);
        expect(QUOTE_CANVAS.height).toBe(1920);
    });

    it('contains the quote, attribution, and source line', () => {
        const json = JSON.stringify(buildQuoteCardTree(card));
        expect(json).toContain(card.quote);
        expect(json).toContain('— Frederick Douglass');
        expect(json).toContain('West India Emancipation speech, 1857');
        expect(json).toContain('Freedom Voices');
    });

    it('omits the source line when source and year are missing', () => {
        const json = JSON.stringify(buildQuoteCardTree({
            quote: card.quote,
            attribution: card.attribution,
        }));
        expect(json).toContain('— Frederick Douglass');
        expect(json).not.toContain('1857');
    });
});

describe('quote_video content schema (loop-length validation)', () => {
    const longScript =
        'If there is no struggle there is no progress. Those who profess to favor freedom and yet deprecate ' +
        'agitation are men who want crops without plowing up the ground; they want rain without thunder and lightning. ' +
        '— Frederick Douglass, 1857';

    it('counts words', () => {
        expect(countWords('one two  three\nfour')).toBe(4);
        expect(countWords('   ')).toBe(0);
    });

    it('accepts a single quote_video piece with a 30+ word script', () => {
        const result = quoteContentResponseSchema.safeParse({
            pieces: [{
                pieceType: 'quote_video',
                script: longScript,
                captionLong: 'caption #a #b #c',
                captionShort: 'caption #a #b',
            }],
        });
        expect(result.success).toBe(true);
        expect(countWords(longScript)).toBeGreaterThanOrEqual(QUOTE_MIN_WORDS);
    });

    it('rejects scripts too short to outlast the loop', () => {
        const result = quoteContentResponseSchema.safeParse({
            pieces: [{
                pieceType: 'quote_video',
                script: 'Too short to read for ten seconds.',
                captionLong: 'caption',
                captionShort: 'caption',
            }],
        });
        expect(result.success).toBe(false);
    });

    it('rejects multi-piece responses', () => {
        const piece = {
            pieceType: 'quote_video',
            script: longScript,
            captionLong: 'c',
            captionShort: 'c',
        };
        expect(quoteContentResponseSchema.safeParse({ pieces: [piece, piece] }).success).toBe(false);
    });

    it('rejects standard piece types', () => {
        expect(quoteContentResponseSchema.safeParse({
            pieces: [{
                pieceType: 'short_1',
                script: longScript,
                captionLong: 'c',
                captionShort: 'c',
            }],
        }).success).toBe(false);
    });
});
