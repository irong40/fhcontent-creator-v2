import { describe, it, expect, vi } from 'vitest';
import {
    generateSlideWithLadder,
    serializeAttempts,
    PHOTO_ATTEMPTS,
    AI_IMAGE_CREDIT,
    type SlideLadderDeps,
    type AuditResult,
    type ArchivalPick,
} from './carousel-slide';
import type { CarouselSlide } from '@/types/database';

const CONSTRAINT = 'Black subjects only, no white people in any frame.';
const ARCHIVAL_RULES = 'Reject caricature, minstrel or degrading material.';

const slide: CarouselSlide = {
    slide: 1,
    text: 'The forgotten foundry workers of Petersburg. Their craft built a city.',
    imagePrompt: 'A historic ironworks scene with workers',
};

const buf = (label: string): ArrayBuffer => {
    const b = new TextEncoder().encode(label);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const archivalPick = (): ArchivalPick => ({
    bytes: buf('archival'),
    credit: 'Library of Congress · LC-USZ62-69316 · [1899?]',
    title: 'Women sorting tobacco',
    sourceUrl: 'https://www.loc.gov/item/2001705878/',
});

/** Build a deps object with sensible spies; override per test. */
function makeDeps(overrides: Partial<SlideLadderDeps> = {}): SlideLadderDeps {
    return {
        generateArchival: vi.fn(async () => archivalPick()),
        generatePhoto: vi.fn(async () => buf('openai')),
        audit: vi.fn(async (): Promise<AuditResult> => ({ pass: true })),
        renderTemplate: vi.fn(async () => buf('template')),
        applyGuardrail: vi.fn((p: string) => `GUARDED: ${p}`),
        archivalAuditRules: ARCHIVAL_RULES,
        log: vi.fn(),
        ...overrides,
    };
}

describe('generateSlideWithLadder', () => {
    it('prefers a real archival photograph and carries its credit through', async () => {
        const deps = makeDeps();
        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('archival');
        expect(result.credit).toBe('Library of Congress · LC-USZ62-69316 · [1899?]');
        expect(result.sourceUrl).toBe('https://www.loc.gov/item/2001705878/');
        expect(deps.generatePhoto).not.toHaveBeenCalled();
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        expect(result.attempts).toEqual([{ provider: 'archival', attempt: 1, outcome: 'used' }]);
    });

    it('audits archival images too — they are photographs, not exempt', async () => {
        const deps = makeDeps();
        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(deps.audit).toHaveBeenCalledTimes(1);
        // The archival rung audits against the persona constraint PLUS the
        // caricature/off-subject rules.
        const [, constraintUsed] = (deps.audit as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(constraintUsed).toContain(CONSTRAINT);
        expect(constraintUsed).toContain(ARCHIVAL_RULES);
    });

    it('falls through a rejected archival image to gpt-image-1', async () => {
        const audit = vi.fn(async (image: ArrayBuffer): Promise<AuditResult> => {
            const label = new TextDecoder().decode(new Uint8Array(image));
            return label === 'openai'
                ? { pass: true }
                : { pass: false, reason: 'white bystander in frame' };
        });
        const deps = makeDeps({ audit });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('openai');
        expect(result.credit).toBe(AI_IMAGE_CREDIT);
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        expect(result.attempts[0]).toMatchObject({ provider: 'archival', outcome: 'rejected' });
        expect(result.attempts.at(-1)).toEqual({ provider: 'openai', attempt: 1, outcome: 'used' });
    });

    it('skips the archival rung cleanly when the catalog has nothing', async () => {
        const deps = makeDeps({ generateArchival: vi.fn(async () => null) });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('openai');
        // A miss is not an error — nothing is logged as an attempt.
        expect(result.attempts.some(a => a.provider === 'archival')).toBe(false);
    });

    it('survives an archival lookup that throws', async () => {
        const deps = makeDeps({
            generateArchival: vi.fn(async () => { throw new Error('LOC timeout'); }),
        });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('openai');
        expect(result.attempts[0]).toMatchObject({ provider: 'archival', outcome: 'error' });
    });

    it('works with no archival dep at all (non-archival persona)', async () => {
        const deps = makeDeps({ generateArchival: undefined });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('openai');
        expect(result.attempts.some(a => a.provider === 'archival')).toBe(false);
    });

    it('falls back to the HUVA template when every photographic rung is rejected', async () => {
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false, reason: 'non-compliant' })),
        });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('template');
        expect(result.credit).toBeUndefined();
        expect(deps.renderTemplate).toHaveBeenCalledTimes(1);
        expect(result.attempts.at(-1)).toEqual({ provider: 'template', attempt: 1, outcome: 'used' });
        // One audit for the archival image + one per gpt-image-1 attempt.
        expect(deps.audit).toHaveBeenCalledTimes(1 + PHOTO_ATTEMPTS);
    });

    it('falls back to the template when the photo provider throws (no infinite loop)', async () => {
        const deps = makeDeps({
            generateArchival: vi.fn(async () => null),
            generatePhoto: vi.fn(async () => { throw new Error('OpenAI quota'); }),
        });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('template');
        // Provider errors are not audited.
        expect(deps.audit).not.toHaveBeenCalled();
        expect(result.attempts.filter(a => a.outcome === 'error')).toHaveLength(PHOTO_ATTEMPTS);
    });

    it('enforces the bounded attempt cap — never exceeds the photo budget', async () => {
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false, reason: 'reject all' })),
        });

        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect((deps.generatePhoto as ReturnType<typeof vi.fn>).mock.calls.length).toBe(PHOTO_ATTEMPTS);
        // The archival catalog is consulted exactly once, never retried.
        expect((deps.generateArchival as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it('strengthens the prompt on each retry to lean harder on the constraint', async () => {
        const deps = makeDeps({
            generateArchival: vi.fn(async () => null),
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false })),
        });

        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        const calls = (deps.generatePhoto as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][0]).not.toContain('RETRY');
        expect(calls[1][0]).toContain('RETRY');
    });

    it('skips the audit entirely for an unconstrained persona (first render wins)', async () => {
        const deps = makeDeps();
        const result = await generateSlideWithLadder(slide, null, deps);

        expect(result.source).toBe('archival');
        expect(deps.audit).not.toHaveBeenCalled();
    });
});

describe('serializeAttempts', () => {
    it('flattens the trace to plain JSON, omitting absent details', () => {
        expect(serializeAttempts([
            { provider: 'archival', attempt: 1, outcome: 'rejected', detail: 'white bystander' },
            { provider: 'openai', attempt: 1, outcome: 'used' },
        ])).toEqual([
            { provider: 'archival', attempt: 1, outcome: 'rejected', detail: 'white bystander' },
            { provider: 'openai', attempt: 1, outcome: 'used' },
        ]);
    });
});
