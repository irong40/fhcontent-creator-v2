import { describe, it, expect } from 'vitest';
import { quoteAttributionLine, quoteVideoScript, sourceNamesSpeaker } from './quote-attribution';

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

    // qcheck r1 F1: live sources (3 of 103) where the name is only part of a book title.
    // Dropping the speaker would credit the book's author, so the speaker stays in front.
    it.each([
        ['4e1a73cd', 'Harriet Tubman', 'Interview with Sarah Bradford, Scenes in the Life of Harriet Tubman, 1869'],
        ['76533d12', 'Harriet Tubman', 'Scenes in the Life of Harriet Tubman by Sarah Bradford, 1869'],
        ['0ba3f5dd', 'Medgar Evers', 'Interview quoted in Medgar Evers: Mississippi Martyr by Michael Vinson Williams, 1963'],
    ])('keeps the speaker in front when the name is only inside a book title (%s)', (_id, speaker, source) => {
        expect(sourceNamesSpeaker(speaker, source)).toBe(false);
        expect(quoteAttributionLine(speaker, source, '')).toBe(`— ${speaker}, ${source}`);
    });

    it('keeps the speaker when the source names them only as a recipient', () => {
        expect(sourceNamesSpeaker('Martin Luther King', 'Letter to Martin Luther King from X')).toBe(false);
    });

    it('treats a name followed by ":" at the start as a book title, not the speaker', () => {
        expect(sourceNamesSpeaker('Harriet Tubman', 'Harriet Tubman: The Road to Freedom by Catherine Clinton')).toBe(false);
    });

    it('takes the name as its own comma field as naming the speaker (9add48ac shape)', () => {
        const source = 'Address to Hattiesburg Freedom Day Rally, Ella Baker, January 21, 1964';
        expect(quoteAttributionLine('Ella Baker', source, '1964')).toBe(`— ${source}, 1964`);
    });

    // qcheck r1 F2: ce19f050, approved and waiting to generate: "&" in the title, "and" in the source.
    it('reads "&" as "and" (ce19f050)', () => {
        const speaker = 'Martin Luther King & Chief Albert John Luthuli';
        const source = 'Martin Luther King and Chief Albert John Luthuli, An Appeal for Action Against Apartheid';
        const line = quoteAttributionLine(speaker, source, '1962');
        expect(line).toBe(`— ${source}, 1962`);
        expect(count(line, 'Chief Albert John Luthuli')).toBe(1);
    });

    // qcheck r1 low finding: name variants.
    it.each([
        ['Dr. Martin Luther King Jr.', 'Martin Luther King Jr., Letter from Birmingham Jail'],
        ['Martin Luther King', "Martin Luther King’s Letter from Birmingham Jail"],
        ['Aimé Césaire', 'Aime Cesaire, Discourse on Colonialism'],
        ['Aimé Césaire', 'Aimé Césaire, Discourse on Colonialism'],
        ['W.E.B. Du Bois', 'WEB Du Bois, The Souls of Black Folk'],
        ['W. E. B. Du Bois', 'speech by W.E.B. Du Bois, Atlanta'],
    ])('matches the name variant %s', (speaker, source) => {
        expect(sourceNamesSpeaker(speaker, source)).toBe(true);
    });
});

describe('quoteVideoScript', () => {
    it('builds the quote and one attribution line from the topic (every writer stores this)', () => {
        const points = [{ claim: 'Life is not a dress rehearsal.', source: 'Martin Luther King, The Drum Major Instinct', year: '1968' }];
        expect(quoteVideoScript('Martin Luther King: Drum Major', points))
            .toBe('Life is not a dress rehearsal.\n\n— Martin Luther King, The Drum Major Instinct, 1968');
    });

    it('returns null when the topic has no quote point', () => {
        expect(quoteVideoScript('Ella Baker: Rally', [])).toBeNull();
        expect(quoteVideoScript('Ella Baker: Rally', null)).toBeNull();
    });
});
