import { describe, expect, it } from 'vitest';
import { buildContentPrompt } from './prompts';
import { buildSourcedQuotePieces, DVB_ATTRIBUTION, sourcedQuoteScriptFaults } from './sourced-quote';
import type { HistoricalPoint, Persona, Topic } from '@/types/database';

const points: HistoricalPoint[] = [
    { point: 1, claim: 'She took charge of a Williamsburg school.', source: DVB_ATTRIBUTION, year: '1887', url: 'https://encyclopediavirginia.org/a', quote: 'In 1887 she took charge of a school in Williamsburg.' },
    { point: 2, claim: 'She was possibly the first such teacher.', source: DVB_ATTRIBUTION, year: '1890', url: 'https://encyclopediavirginia.org/b', quote: 'She was possibly the first Black woman to teach there.' },
    { point: 3, claim: 'He promised to resist.', source: DVB_ATTRIBUTION, year: '1867', url: 'https://encyclopediavirginia.org/c', quote: 'He promised to resist the order and won by 641 votes.' },
];
const script = (body: string) => `“${body}”\n\n— ${DVB_ATTRIBUTION}`;

describe('sourced_quote pieces', () => {
    it('builds one piece per point: the passage, then the Dictionary of Virginia Biography', () => {
        const pieces = buildSourcedQuotePieces(points);
        expect(pieces).toHaveLength(3);
        expect(pieces[0].script).toBe(script(points[0].quote!));
        for (const p of pieces) expect(sourcedQuoteScriptFaults(points, p.script)).toEqual([]);
    });

    it('refuses an added legacy line', () => {
        const f = sourcedQuoteScriptFaults(points, script(`${points[0].quote} It changed the course of history.`));
        expect(f).toContain('adds words the source passage does not have');
    });

    it('refuses a dropped hedge', () => {
        const f = sourcedQuoteScriptFaults(points, script('She was the first Black woman to teach there.'));
        expect(f.some(x => x.startsWith("drops the source's hedge: possibly"))).toBe(true);
    });

    it('refuses a changed verb', () => {
        const f = sourcedQuoteScriptFaults(points, script('He threatened to resist the order and won by 641 votes.'));
        expect(f.some(x => x.includes('threatened'))).toBe(true);
    });

    it('refuses a number the points do not have', () => {
        const f = sourcedQuoteScriptFaults(points, script('He promised to resist the order and won by 3,000 votes.'));
        expect(f).toContain('has numbers not in the points: 3000');
    });

    it('refuses a script without the Dictionary of Virginia Biography', () => {
        expect(sourcedQuoteScriptFaults(points, `“${points[0].quote}”`))
            .toContain(`last line must be the attribution "— ${DVB_ATTRIBUTION}"`);
    });

    it('routes sourced_quote personas to the quote-style prompt, never the 6-piece one', () => {
        const persona = { name: 'Dr. Imani Carter', brand: 'History Unveiled VA', voice_style: 'warm', content_format: 'sourced_quote' } as unknown as Persona;
        const topic = { title: 'A teacher', hook: 'h', historical_points: points } as unknown as Topic;
        const { system, user } = buildContentPrompt(persona, topic);
        expect(user).toContain(script(points[0].quote!));
        expect(user).not.toContain('Generate content for 6 pieces');
        expect(system).toContain('Add nothing else');
    });
});
