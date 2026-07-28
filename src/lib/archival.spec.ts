import { describe, it, expect } from 'vitest';
import {
    buildArchivalQueries,
    isPubliclyUsable,
    isSinglePhotograph,
    prescreen,
    largestDerivative,
    buildCredit,
} from './archival';

describe('isPubliclyUsable', () => {
    it('accepts the explicit LOC clearance phrasings', () => {
        expect(isPubliclyUsable('No known restrictions on publication.')).toBe(true);
        expect(isPubliclyUsable('No known restrictions on images made by the U.S. Government.')).toBe(true);
        expect(isPubliclyUsable(['Public domain.'])).toBe(true);
    });

    it('rejects restricted collections', () => {
        expect(isPubliclyUsable(
            'Publication may be restricted. For information see "Visual Materials from the NAACP Records".',
        )).toBe(false);
        expect(isPubliclyUsable('Permission required from the copyright holder.')).toBe(false);
    });

    it('fails closed on silence and on unevaluated status', () => {
        // Silence is not permission — a blank rights field must never clear.
        expect(isPubliclyUsable('')).toBe(false);
        expect(isPubliclyUsable(null)).toBe(false);
        expect(isPubliclyUsable(undefined)).toBe(false);
        expect(isPubliclyUsable('Rights status of individual images not evaluated.')).toBe(false);
    });

    it('rejects a statement that clears then re-restricts', () => {
        expect(isPubliclyUsable(
            'No known restrictions for most items; publication may be restricted for others.',
        )).toBe(false);
    });
});

describe('isSinglePhotograph', () => {
    it('accepts records describing exactly one photograph', () => {
        expect(isSinglePhotograph('1 photographic print.')).toBe(true);
        expect(isSinglePhotograph(['1 photograph : gelatin silver.'])).toBe(true);
    });

    it('rejects lithographs and other non-photographic prints', () => {
        // "Starlight Bess, of pure Virginia stock" — an 1869 lithograph of a horse.
        expect(isSinglePhotograph('1 print :')).toBe(false);
        expect(isSinglePhotograph('8 prints (1 sheet) :')).toBe(false);
    });

    it('rejects multi-item container records whose thumbnail is arbitrary', () => {
        expect(isSinglePhotograph('120 photoprints :')).toBe(false);
        expect(isSinglePhotograph('95 photographic prints :\n1 print :')).toBe(false);
        expect(isSinglePhotograph('18 photographic prints on stereo cards :')).toBe(false);
    });

    it('rejects HABS/HAER documentation text pages', () => {
        expect(isSinglePhotograph('Data Page(s): 21')).toBe(false);
        expect(isSinglePhotograph('')).toBe(false);
    });
});

describe('prescreen', () => {
    const cleared = { medium: '1 photographic print.', rights_advisory: 'No known restrictions on publication.' };

    it('passes a rights-cleared single photograph', () => {
        expect(prescreen({ title: 'Women sorting tobacco, Richmond', item: cleared })).toBeNull();
    });

    it('rejects caricature and minstrel material that would pass a subject check', () => {
        // This DOES depict Black figures, so "are the subjects Black?" is the
        // wrong question — the marker list is what catches it.
        expect(prescreen({
            title: 'Ye veracious chronicle of Gruff & Pompey in 7 tableaux',
            item: cleared,
        })).toBe('caricature/degrading marker');
    });

    it('rejects degrading and violent material via subject headings', () => {
        expect(prescreen({
            title: 'A burial party on the battle-field of Cold Harbor',
            item: cleared,
        })).toBe('caricature/degrading marker');
    });

    it('rejects uncleared rights before any download', () => {
        expect(prescreen({
            title: 'Picket - tobacco workers',
            item: { medium: '1 photographic print.', rights_advisory: 'Publication may be restricted.' },
        })).toBe('rights not cleared');
    });

    it('rejects non-photographs first', () => {
        expect(prescreen({ title: 'Sheridan\'s ride', item: { medium: '192 photoprints :' } }))
            .toBe('not a single photograph');
    });
});

describe('largestDerivative', () => {
    it('picks the widest annotated JPEG', () => {
        expect(largestDerivative([
            'https://tile.loc.gov/x/3b16756_150px.jpg#h=118&w=150',
            'https://tile.loc.gov/x/3b16756r.jpg#h=504&w=640',
            'https://tile.loc.gov/x/3b16756v.jpg#h=807&w=1024',
        ])).toBe('https://tile.loc.gov/x/3b16756v.jpg');
    });

    it('skips thumbnails below the usable width', () => {
        expect(largestDerivative(['https://tile.loc.gov/x/a_150px.jpg#h=150&w=121'])).toBeNull();
    });

    it('skips the group-of-images placeholder SVG', () => {
        expect(largestDerivative([
            'https://www.loc.gov/static/images/original-format/group-of-images.svg',
        ])).toBeNull();
    });

    it('handles a missing image list', () => {
        expect(largestDerivative(undefined)).toBeNull();
    });
});

describe('buildCredit', () => {
    it('strips the parenthetical from the reproduction number and keeps the date', () => {
        expect(buildCredit({
            reproduction_number: 'LC-USZ62-69316 (b&w film copy neg.)',
            created_published_date: '[1899?]',
        })).toBe('Library of Congress · LC-USZ62-69316 · [1899?]');
    });

    it('falls back to the call number', () => {
        expect(buildCredit({ call_number: 'LOT 11302 [P&P]', created_published_date: '1899' }))
            .toBe('Library of Congress · LOT 11302 [P&P] · 1899');
    });

    it('degrades to the bare institution when no identifier exists', () => {
        expect(buildCredit({})).toBe('Library of Congress');
    });
});

describe('buildArchivalQueries', () => {
    it('maps narrative headlines onto catalog subject and place terms', () => {
        const qs = buildArchivalQueries(
            'The Midnight Riders of Pittsylvania County: How 80 Black Landowners Stopped Tax Collectors at Gunpoint (1891)',
            'armed horsemen protected tobacco land',
        );
        // "midnight riders" matches nothing in the catalog; "tobacco" does.
        expect(qs[0]).toContain('tobacco');
        expect(qs[0]).toContain('pittsylvania');
    });

    it('orders the cascade specific → general', () => {
        const qs = buildArchivalQueries('The Fredericksburg Silk Cooperative textile mill');
        expect(qs[0]).toBe('mill fredericksburg');
        expect(qs).toContain('mill virginia');
    });

    it('never emits a bare unanchored query — that is where caricature surfaces', () => {
        const qs = buildArchivalQueries('A story with no recognisable subject or place');
        expect(qs.every(q => q.trim().length > 0)).toBe(true);
        // The subject facet does the anchoring; queries stay scoped to Virginia.
        expect(qs).toEqual(['virginia']);
    });

    it('detects counties that are not on the curated place list', () => {
        const qs = buildArchivalQueries('The schoolhouse in Nansemond County');
        expect(qs[0]).toBe('school nansemond');
    });
});
