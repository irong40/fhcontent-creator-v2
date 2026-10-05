/**
 * Every writer sees the source passages and the source rule (Codex review 2026-10-05, finding 7).
 * Before this only the first-draft script prompt carried them. The quote-video, carousel,
 * podcast, newsletter and remix prompts showed the claims alone, and some asked outright for
 * added context and quotations.
 */
import { describe, it, expect } from 'vitest';
import {
    buildContentPrompt,
    buildCarouselSlidesPrompt,
    buildPodcastScriptPrompt,
    buildNewsletterDraftPrompt,
    buildRemixPrompt,
} from './prompts';
import type { RemixField } from './prompts';
import { pointLines } from './sourced-topics';
import type { Persona, Topic, HistoricalPoint } from '@/types/database';

const sourced = [1, 2, 3, 4].map(n => ({
    point: n,
    claim: `Claim ${n}`,
    source: 'Dictionary of Virginia Biography',
    year: '1867',
    url: `https://www.lva.virginia.gov/collections/dvb/bio/p${n}`,
    quote: `Passage ${n} as the page prints it.`,
})) as unknown as HistoricalPoint[];
const plain = [1, 2, 3, 4].map(n => ({ point: n, claim: `Claim ${n}`, source: 'A book', year: '1900' })) as unknown as HistoricalPoint[];

const persona = (kind: string) => ({
    name: 'Dr. Imani Carter', brand: 'History Unveiled VA', voice_style: 'warm', content_guidelines: null,
    content_format: kind, newsletter_cta: 'Subscribe.', image_subject_constraint: null,
}) as unknown as Persona;
const topic = (points: HistoricalPoint[]) => ({
    title: 'Thomas Bayne: The Delegate', hook: 'A hook.', historical_points: points,
}) as unknown as Topic;

const FIELDS: RemixField[] = ['script', 'caption_long', 'caption_short', 'thumbnail_prompt', 'carousel_slides'];

/** name, the prompt for these points, and the words that open the writer's task */
function writers(points: HistoricalPoint[]): Array<[string, string, string]> {
    const t = topic(points);
    return [
        ['first draft', buildContentPrompt(persona('standard'), t).user, 'Generate content for 6 pieces'],
        ['carousel', buildCarouselSlidesPrompt(t, points, 'warm').user, 'Generate 8-10 carousel slides'],
        ['podcast', buildPodcastScriptPrompt(t, 'The long script.', 'History Unveiled VA', 'Follow.').user, 'ORIGINAL SHORT SCRIPT'],
        ['newsletter', buildNewsletterDraftPrompt(persona('standard'), t, 'The long script.').user, 'ORIGINAL VIDEO SCRIPT'],
        ...FIELDS.map((f): [string, string, string] =>
            [`remix ${f}`, buildRemixPrompt(persona('standard'), t, 'long', f, 'The current text.').user, 'CURRENT ']),
    ];
}

describe('every writer of a sourced topic', () => {
    it.each(writers(sourced))('%s: shows all four passages, then the source rule, then its task', (_name, user, task) => {
        for (const n of [1, 2, 3, 4]) {
            expect(user).toContain(`${n}. Claim ${n} (Source: Dictionary of Virginia Biography, 1867)\n   SOURCE PASSAGE: "Passage ${n} as the page prints it."`);
        }
        expect(user).toContain('SOURCE DISCIPLINE');
        expect(user).toContain('These rules come first.');
        expect(user.indexOf('Passage 4 as the page prints it.')).toBeLessThan(user.indexOf('SOURCE DISCIPLINE'));
        expect(user.indexOf('SOURCE DISCIPLINE')).toBeLessThan(user.indexOf(task));
    });

    it('quote video: shows the passage under each supporting fact and the source rule', () => {
        const { user } = buildContentPrompt(persona('quote_video'), topic(sourced));
        for (const n of [2, 3, 4]) {
            expect(user).toContain(`- Claim ${n} (Dictionary of Virginia Biography, 1867)\n  SOURCE PASSAGE: "Passage ${n} as the page prints it."`);
        }
        expect(user).toContain('SOURCE DISCIPLINE');
        expect(user.indexOf('SOURCE DISCIPLINE')).toBeLessThan(user.indexOf('Generate content for 1 piece'));
    });
});

describe('every writer of a topic with no source passages', () => {
    it.each(writers(plain))('%s: prints the points as it always did', (_name, user, task) => {
        expect(user).not.toContain('SOURCE PASSAGE');
        expect(user).not.toContain('SOURCE DISCIPLINE');
        expect(user).toContain(`HISTORICAL POINTS:\n1. Claim 1 (Source: A book, 1900)\n2. Claim 2 (Source: A book, 1900)\n3. Claim 3 (Source: A book, 1900)\n4. Claim 4 (Source: A book, 1900)\n\n${task}`);
    });

    it('quote video: no passage lines and no rule', () => {
        const { user } = buildContentPrompt(persona('quote_video'), topic(plain));
        expect(user).not.toContain('SOURCE PASSAGE');
        expect(user).not.toContain('SOURCE DISCIPLINE');
        expect(user).toContain('- Claim 4 (A book, 1900)\n\nGenerate content for 1 piece');
    });

    it('pointLines ignores an empty passage', () => {
        expect(pointLines([{ point: 1, claim: 'C', source: 'S', year: '1900', quote: '  ' }])).toBe('1. C (Source: S, 1900)');
    });
});
