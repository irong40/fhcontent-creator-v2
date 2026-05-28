import { describe, it, expect, vi } from 'vitest';
import {
    generateSlideWithLadder,
    DALL_E_ATTEMPTS,
    GEMINI_ATTEMPTS,
    type SlideLadderDeps,
    type AuditResult,
} from './carousel-slide';
import type { CarouselSlide } from '@/types/database';

const CONSTRAINT = 'Black subjects only, no white people in any frame.';

const slide: CarouselSlide = {
    slide: 1,
    text: 'The forgotten foundry workers of Petersburg. Their craft built a city.',
    imagePrompt: 'A historic ironworks scene with workers',
};

const buf = (label: string): ArrayBuffer => {
    const b = new TextEncoder().encode(label);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Build a deps object with sensible spies; override per test. */
function makeDeps(overrides: Partial<SlideLadderDeps> = {}): SlideLadderDeps {
    return {
        generateDalle: vi.fn(async () => buf('dalle')),
        generateGemini: vi.fn(async () => buf('gemini')),
        audit: vi.fn(async (): Promise<AuditResult> => ({ pass: true })),
        renderTemplate: vi.fn(async () => buf('template')),
        applyGuardrail: vi.fn((p: string) => `GUARDED: ${p}`),
        log: vi.fn(),
        ...overrides,
    };
}

describe('generateSlideWithLadder', () => {
    it('uses DALL-E when its first render passes the audit', async () => {
        const deps = makeDeps();
        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('dalle');
        expect(deps.generateDalle).toHaveBeenCalledTimes(1);
        expect(deps.generateGemini).not.toHaveBeenCalled();
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        expect(deps.audit).toHaveBeenCalledTimes(1);
        // First attempt is the guarded prompt, no retry reinforcement.
        expect(result.attempts).toEqual([{ provider: 'dalle', attempt: 1, outcome: 'used' }]);
    });

    it('falls through DALL-E rejection to a passing Gemini render', async () => {
        // DALL-E always rejected by audit; Gemini passes on its first try.
        const audit = vi.fn(async (image: ArrayBuffer): Promise<AuditResult> => {
            const label = new TextDecoder().decode(new Uint8Array(image));
            return label === 'gemini' ? { pass: true } : { pass: false, reason: 'white person in background' };
        });
        const deps = makeDeps({ audit });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('gemini');
        // DALL-E exhausted its full attempt budget before falling through.
        expect(deps.generateDalle).toHaveBeenCalledTimes(DALL_E_ATTEMPTS);
        expect(deps.generateGemini).toHaveBeenCalledTimes(1);
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        // Trace shows DALL-E rejections then the Gemini win.
        const rejected = result.attempts.filter(a => a.outcome === 'rejected');
        expect(rejected).toHaveLength(DALL_E_ATTEMPTS);
        expect(result.attempts.at(-1)).toEqual({ provider: 'gemini', attempt: 1, outcome: 'used' });
    });

    it('falls back to the HUVA template when both providers are rejected', async () => {
        // Every photographic render fails the audit → template is the only escape.
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false, reason: 'non-compliant' })),
        });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('template');
        expect(deps.renderTemplate).toHaveBeenCalledTimes(1);
        expect(result.attempts.at(-1)).toEqual({ provider: 'template', attempt: 1, outcome: 'used' });
        // Audit never bypassed for photographic attempts (one per photographic try).
        expect(deps.audit).toHaveBeenCalledTimes(DALL_E_ATTEMPTS + GEMINI_ATTEMPTS);
    });

    it('falls back to the template when both providers throw (no infinite loop)', async () => {
        const deps = makeDeps({
            generateDalle: vi.fn(async () => { throw new Error('DALL-E 429'); }),
            generateGemini: vi.fn(async () => { throw new Error('Gemini quota'); }),
        });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('template');
        // Provider errors are not audited.
        expect(deps.audit).not.toHaveBeenCalled();
        const errors = result.attempts.filter(a => a.outcome === 'error');
        expect(errors).toHaveLength(DALL_E_ATTEMPTS + GEMINI_ATTEMPTS);
    });

    it('enforces the bounded attempt cap — never exceeds the per-provider budget', async () => {
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false, reason: 'reject all' })),
        });

        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        // Hard caps: exactly DALL_E_ATTEMPTS + GEMINI_ATTEMPTS photographic calls, no more.
        expect((deps.generateDalle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(DALL_E_ATTEMPTS);
        expect((deps.generateGemini as ReturnType<typeof vi.fn>).mock.calls.length).toBe(GEMINI_ATTEMPTS);
        expect((deps.generateDalle as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(DALL_E_ATTEMPTS);
        expect((deps.generateGemini as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(GEMINI_ATTEMPTS);
    });

    it('strengthens the prompt on each retry to lean harder on the constraint', async () => {
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false })),
        });

        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        const dalleCalls = (deps.generateDalle as ReturnType<typeof vi.fn>).mock.calls;
        // First DALL-E attempt is the plain guarded prompt.
        expect(dalleCalls[0][0]).not.toContain('RETRY');
        // Second attempt carries retry reinforcement.
        expect(dalleCalls[1][0]).toContain('RETRY');
    });

    it('skips the audit entirely for an unconstrained persona (first render wins)', async () => {
        const deps = makeDeps();
        const result = await generateSlideWithLadder(slide, null, deps);

        expect(result.source).toBe('dalle');
        expect(deps.audit).not.toHaveBeenCalled();
        expect(deps.generateDalle).toHaveBeenCalledTimes(1);
    });
});
