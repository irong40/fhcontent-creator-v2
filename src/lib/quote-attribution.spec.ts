import { describe, it, expect } from 'vitest';
import { quoteAttributionLine, sourceNamesSpeaker } from './quote-attribution';

const count = (text: string, name: string) => text.split(name).length - 1;

describe('quoteAttributionLine', () => {
    it('names the speaker once when the source opens with the name (the 11-24 fault)', () => {
        const line = quoteAttributionLine(
            'Martin Luther King',
            'Martin Luther King, "Poverty and the World House," statement, 1967',
            '1967',
        );
        expect(count(line, 'Martin Luther King')).toBe(1);
        expect(line).toBe('— Martin Luther King, "Poverty and the World House," statement, 1967, 1967');
    });

    it('names the speaker once when the name sits mid-source', () => {
        const line = quoteAttributionLine(
            'Martin Luther King',
            'Give Us the Ballot, speech by Martin Luther King, steps of the Lincoln Memorial',
            '1957',
        );
        expect(count(line, 'Martin Luther King')).toBe(1);
    });

    it('adds the speaker when the source does not name them', () => {
        expect(quoteAttributionLine('Ella Baker', 'Address to Hattiesburg Freedom Day Rally', '1964'))
            .toBe('— Ella Baker, Address to Hattiesburg Freedom Day Rally, 1964');
    });

    it('matches whole words only', () => {
        expect(sourceNamesSpeaker('Martin King', 'Martin Kingsley memoir')).toBe(false);
    });

    it('leaves out an empty source or year without stray commas', () => {
        expect(quoteAttributionLine('Ella Baker', '', '1964')).toBe('— Ella Baker, 1964');
        expect(quoteAttributionLine('Ella Baker', 'Speech', '')).toBe('— Ella Baker, Speech');
    });
});
