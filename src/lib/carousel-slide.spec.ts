import { describe, it, expect, vi } from 'vitest';
import {
    generateSlideWithLadder,
    PRIMARY_ATTEMPTS,
    SECONDARY_ATTEMPTS,
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
        generatePrimary: vi.fn(async () => buf('imagen')),
        generateSecondary: vi.fn(async () => buf('openai')),
        audit: vi.fn(async (): Promise<AuditResult> => ({ pass: true })),
        renderTemplate: vi.fn(async () => buf('template')),
        applyGuardrail: vi.fn((p: string) => `GUARDED: ${p}`),
        log: vi.fn(),
        ...overrides,
    };
}

describe('generateSlideWithLadder', () => {
    it('uses the primary provider (Imagen) when its first render passes the audit', async () => {
        const deps = makeDeps();
        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('imagen');
        expect(deps.generatePrimary).toHaveBeenCalledTimes(1);
        expect(deps.generateSecondary).not.toHaveBeenCalled();
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        expect(deps.audit).toHaveBeenCalledTimes(1);
        // First attempt is the guarded prompt, no retry reinforcement.
        expect(result.attempts).toEqual([{ provider: 'imagen', attempt: 1, outcome: 'used' }]);
    });

    it('falls through primary rejection to a passing secondary render', async () => {
        // Imagen always rejected by audit; gpt-image-1 passes on its first try.
        const audit = vi.fn(async (image: ArrayBuffer): Promise<AuditResult> => {
            const label = new TextDecoder().decode(new Uint8Array(image));
            return label === 'openai' ? { pass: true } : { pass: false, reason: 'white person in background' };
        });
        const deps = makeDeps({ audit });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('openai');
        // Primary exhausted its full attempt budget before falling through.
        expect(deps.generatePrimary).toHaveBeenCalledTimes(PRIMARY_ATTEMPTS);
        expect(deps.generateSecondary).toHaveBeenCalledTimes(1);
        expect(deps.renderTemplate).not.toHaveBeenCalled();
        // Trace shows primary rejections then the secondary win.
        const rejected = result.attempts.filter(a => a.outcome === 'rejected');
        expect(rejected).toHaveLength(PRIMARY_ATTEMPTS);
        expect(result.attempts.at(-1)).toEqual({ provider: 'openai', attempt: 1, outcome: 'used' });
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
        expect(deps.audit).toHaveBeenCalledTimes(PRIMARY_ATTEMPTS + SECONDARY_ATTEMPTS);
    });

    it('falls back to the template when both providers throw (no infinite loop)', async () => {
        const deps = makeDeps({
            generatePrimary: vi.fn(async () => { throw new Error('Imagen 400'); }),
            generateSecondary: vi.fn(async () => { throw new Error('OpenAI quota'); }),
        });

        const result = await generateSlideWithLadder(slide, CONSTRAINT, deps);

        expect(result.source).toBe('template');
        // Provider errors are not audited.
        expect(deps.audit).not.toHaveBeenCalled();
        const errors = result.attempts.filter(a => a.outcome === 'error');
        expect(errors).toHaveLength(PRIMARY_ATTEMPTS + SECONDARY_ATTEMPTS);
    });

    it('enforces the bounded attempt cap — never exceeds the per-provider budget', async () => {
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false, reason: 'reject all' })),
        });

        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        // Hard caps: exactly PRIMARY_ATTEMPTS + SECONDARY_ATTEMPTS photographic calls, no more.
        expect((deps.generatePrimary as ReturnType<typeof vi.fn>).mock.calls.length).toBe(PRIMARY_ATTEMPTS);
        expect((deps.generateSecondary as ReturnType<typeof vi.fn>).mock.calls.length).toBe(SECONDARY_ATTEMPTS);
        expect((deps.generatePrimary as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(PRIMARY_ATTEMPTS);
        expect((deps.generateSecondary as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(SECONDARY_ATTEMPTS);
    });

    it('strengthens the prompt on each retry to lean harder on the constraint', async () => {
        const deps = makeDeps({
            audit: vi.fn(async (): Promise<AuditResult> => ({ pass: false })),
        });

        await generateSlideWithLadder(slide, CONSTRAINT, deps);

        const primaryCalls = (deps.generatePrimary as ReturnType<typeof vi.fn>).mock.calls;
        // First primary attempt is the plain guarded prompt.
        expect(primaryCalls[0][0]).not.toContain('RETRY');
        // Second attempt carries retry reinforcement.
        expect(primaryCalls[1][0]).toContain('RETRY');
    });

    it('skips the audit entirely for an unconstrained persona (first render wins)', async () => {
        const deps = makeDeps();
        const result = await generateSlideWithLadder(slide, null, deps);

        expect(result.source).toBe('imagen');
        expect(deps.audit).not.toHaveBeenCalled();
        expect(deps.generatePrimary).toHaveBeenCalledTimes(1);
    });
});
