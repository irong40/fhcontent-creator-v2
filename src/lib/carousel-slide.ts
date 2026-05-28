/**
 * Carousel slide generation — audit-driven provider retry ladder.
 *
 * Each slide is produced by an explicit, bounded retry ladder:
 *   1. DALL-E   → audit. Pass ⇒ use it.
 *   2. Gemini   → re-audit (with a constraint-strengthened prompt).
 *   3. Gemini   → re-audit (final strengthened retry).
 *   4. HUVA Playwright text template (non-photographic, no people — always passes).
 *
 * Attempt budget is bounded per slide (DALL_E_ATTEMPTS DALL-E + GEMINI_ATTEMPTS
 * Gemini), so there is no runaway image-API spend and no infinite loop. The
 * template fallback is $0 and always succeeds, so a slide only fails if even the
 * template renderer throws.
 *
 * IMPORTANT: this module does NOT weaken the subject-constraint audit. Every
 * photographic attempt (DALL-E or Gemini) must still pass `auditImageSubjects`.
 * Only the non-photographic template fallback bypasses the audit — and it does so
 * legitimately, because it renders zero human figures.
 *
 * The orchestrator takes all I/O as injected dependencies (providers, audit,
 * template renderer) so it is fully unit-testable without live API calls.
 */

import type { CarouselSlide } from '@/types/database';

/** Max DALL-E attempts per slide before falling through to Gemini. */
export const DALL_E_ATTEMPTS = 2;
/** Max Gemini attempts per slide before falling through to the template. */
export const GEMINI_ATTEMPTS = 2;

export type SlideProvider = 'dalle' | 'gemini' | 'template';

export interface SlideAttemptLog {
    provider: SlideProvider;
    attempt: number;
    /** 'used' = produced the final image; 'rejected' = audit failed; 'error' = provider threw. */
    outcome: 'used' | 'rejected' | 'error';
    detail?: string;
}

export interface SlideResult {
    slide: number;
    /** The image bytes that won (photographic or rendered template). */
    imageBuffer: ArrayBuffer;
    /** Which provider produced the winning image. */
    source: SlideProvider;
    /** Per-attempt trace for logging / observability. */
    attempts: SlideAttemptLog[];
}

export interface AuditResult {
    pass: boolean;
    reason?: string;
}

/**
 * Injected I/O for the slide ladder. All functions return ArrayBuffers of PNG
 * bytes (template included) and may throw on provider error.
 */
export interface SlideLadderDeps {
    /** Generate a photographic image with DALL-E. Returns PNG bytes. */
    generateDalle: (prompt: string) => Promise<ArrayBuffer>;
    /** Generate a photographic image with Gemini Imagen. Returns PNG bytes. */
    generateGemini: (prompt: string) => Promise<ArrayBuffer>;
    /** Audit a photographic image against the persona subject constraint. */
    audit: (image: ArrayBuffer, constraint: string) => Promise<AuditResult>;
    /** Render the non-photographic HUVA text template for this slide. Returns PNG bytes. */
    renderTemplate: (slide: CarouselSlide) => Promise<ArrayBuffer>;
    /** Apply the persona subject guardrail to a base prompt (no-op when no constraint). */
    applyGuardrail: (prompt: string, constraint: string | null | undefined) => string;
    /** Optional structured logger; defaults to console. */
    log?: (msg: string) => void;
}

/**
 * Strengthen a guarded prompt for retry attempts. Each retry leans harder on the
 * single-subject / no-incidental-people discipline that trips the HUVA audit.
 */
function strengthenPrompt(guardedPrompt: string, retryIndex: number): string {
    if (retryIndex <= 0) return guardedPrompt;
    const reinforcement =
        `\n\nRETRY ${retryIndex}: the previous render was rejected by an editorial audit. ` +
        'Render ONLY the single specified subject with dark brown skin clearly visible, ' +
        'OR omit all human figures entirely and render objects / documents / architecture / landscape. ' +
        'Absolutely no additional, background, or incidental people of any skin tone.';
    return guardedPrompt + reinforcement;
}

/**
 * Run the audit-driven retry ladder for a single slide.
 *
 * When `constraint` is null/empty the audit is skipped (unconstrained persona):
 * the first successful photographic provider wins. When a constraint is set,
 * every photographic image must pass `audit` before it is accepted.
 *
 * Always resolves with a usable image (template fallback is last resort) unless
 * the template renderer itself throws — in which case it throws so the caller can
 * mark just that slide failed.
 */
export async function generateSlideWithLadder(
    slide: CarouselSlide,
    constraint: string | null | undefined,
    deps: SlideLadderDeps,
): Promise<SlideResult> {
    const log = deps.log ?? ((m: string) => console.log(m));
    const attempts: SlideAttemptLog[] = [];
    const basePrompt = deps.applyGuardrail(slide.imagePrompt, constraint);

    const tryPhotographic = async (
        provider: 'dalle' | 'gemini',
        attempt: number,
        prompt: string,
    ): Promise<ArrayBuffer | null> => {
        let image: ArrayBuffer;
        try {
            image = provider === 'dalle'
                ? await deps.generateDalle(prompt)
                : await deps.generateGemini(prompt);
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            attempts.push({ provider, attempt, outcome: 'error', detail: detail.slice(0, 200) });
            log(`[carousel] slide ${slide.slide}: ${provider} attempt ${attempt} error: ${detail.slice(0, 120)}`);
            return null;
        }

        // No constraint ⇒ first successful render wins (audit not applicable).
        if (!constraint) {
            attempts.push({ provider, attempt, outcome: 'used' });
            return image;
        }

        const verdict = await deps.audit(image, constraint);
        if (verdict.pass) {
            attempts.push({ provider, attempt, outcome: 'used' });
            return image;
        }
        attempts.push({ provider, attempt, outcome: 'rejected', detail: verdict.reason });
        log(`[carousel] slide ${slide.slide}: ${provider} attempt ${attempt} audit-rejected: ${verdict.reason ?? 'unspecified'}`);
        return null;
    };

    // ── Rung 1: DALL-E (bounded attempts) ──
    for (let i = 0; i < DALL_E_ATTEMPTS; i++) {
        const prompt = strengthenPrompt(basePrompt, i);
        const image = await tryPhotographic('dalle', i + 1, prompt);
        if (image) {
            log(`[carousel] slide ${slide.slide}: produced by dalle (attempt ${i + 1})`);
            return { slide: slide.slide, imageBuffer: image, source: 'dalle', attempts };
        }
    }

    // ── Rung 2: Gemini Imagen (bounded attempts, constraint-strengthened) ──
    for (let i = 0; i < GEMINI_ATTEMPTS; i++) {
        // Continue strengthening past the DALL-E attempts so each Gemini retry is harder.
        const prompt = strengthenPrompt(basePrompt, DALL_E_ATTEMPTS + i);
        const image = await tryPhotographic('gemini', i + 1, prompt);
        if (image) {
            log(`[carousel] slide ${slide.slide}: produced by gemini (attempt ${i + 1})`);
            return { slide: slide.slide, imageBuffer: image, source: 'gemini', attempts };
        }
    }

    // ── Rung 3: HUVA Playwright text template (non-photographic, no people) ──
    // Always compliant by construction, so it bypasses the audit legitimately.
    const templateImage = await deps.renderTemplate(slide);
    attempts.push({ provider: 'template', attempt: 1, outcome: 'used' });
    log(`[carousel] slide ${slide.slide}: produced by template fallback`);
    return { slide: slide.slide, imageBuffer: templateImage, source: 'template', attempts };
}
