import { describe, it, expect } from 'vitest';
import { fillHuvaTemplate, buildHuvaSlideHtml } from './huva-template';
import type { CarouselSlide } from '@/types/database';

describe('fillHuvaTemplate', () => {
    it('replaces {{var}} placeholders and leaves unknown ones intact', () => {
        const html = '<h1>{{title}}</h1><p>{{body}}</p><span>{{missing}}</span>';
        const out = fillHuvaTemplate(html, { title: 'Foundry', body: 'Workers' });
        expect(out).toBe('<h1>Foundry</h1><p>Workers</p><span>{{missing}}</span>');
    });
});

describe('buildHuvaSlideHtml', () => {
    const slide: CarouselSlide = {
        slide: 2,
        text: 'The foundry workers of Petersburg. Their craft built a city.',
        imagePrompt: 'irrelevant for the text template',
    };

    it('interpolates slide metadata into the real HUVA carousel template', () => {
        const html = buildHuvaSlideHtml(slide, 8, { eyebrow: 'History Unveiled VA' });

        // Placeholders are resolved (no leftover {{...}}).
        expect(html).not.toMatch(/\{\{\w+\}\}/);
        // Slide numbering rendered.
        expect(html).toContain('2 / 8');
        // Headline derived from the first clause of the slide text.
        expect(html).toContain('The foundry workers of Petersburg');
        // It is the carousel-slide template (non-photographic, no people).
        expect(html).toContain('data-template="carousel-slide"');
    });

    it('falls back to a slide label when text is empty', () => {
        const empty: CarouselSlide = { slide: 5, text: '', imagePrompt: 'x' };
        const html = buildHuvaSlideHtml(empty, 8);
        expect(html).toContain('Slide 5');
    });
});
