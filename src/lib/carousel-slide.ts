/**
 * Photoreal image generation — audit-driven provider retry ladder.
 *
 * Used for THUMBNAILS / photoreal slides (images that legitimately depict
 * people and must pass the HUVA subject audit). Each image is produced by an
 * explicit, bounded retry ladder:
 *   1. Imagen 4 (primary)   → audit. Pass ⇒ use it.
 *   2. Imagen 4 (retry)     → re-audit (constraint-strengthened prompt).
 *   3. gpt-image-1 (secondary) → audit.
 *   4. gpt-image-1 (retry)  → re-audit (final strengthened retry).
 *   5. HUVA satori text template (non-photographic, no people — always passes).
 *
 * Attempt budget is bounded per image (PRIMARY_ATTEMPTS Imagen + SECONDARY_ATTEMPTS
 * gpt-image-1), so there is no runaway image-API spend and no infinite loop. The
 * template fallback is $0 and always succeeds, so an image only fails if even the
 * template renderer throws.
 *
 * NOTE ON CAROUSELS: HUVA carousel *slides* are text-over-background with NO
 * people, so they are rendered TEMPLATE-FIRST (satori) directly by the caller and
 * do NOT go through this generative ladder. This ladder is for photoreal images.
 *
 * IMPORTANT: this module does NOT weaken the subject-constraint audit. Every
 * photographic attempt (primary or secondary) must still pass `auditImageSubjects`.
 * Only the non-photographic template fallback bypasses the audit — and it does so
 * legitimately, because it renders zero human figures.
 *
 * The orchestrator takes all I/O as injected dependencies (providers, audit,
 * template renderer) so it is fully unit-testable without live API calls.
 */

import type { CarouselSlide } from '@/types/database';

/** Max primary-provider (Imagen 4) attempts before falling through to the secondary. */
export const PRIMARY_ATTEMPTS = 2;
/** Max secondary-provider (gpt-image-1) attempts before falling through to the template. */
export const SECONDARY_ATTEMPTS = 2;

export type SlideProvider = 'imagen' | 'openai' | 'template';

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
    /** Generate a photographic image with the primary provider (Imagen 4). Returns PNG bytes. */
    generatePrimary: (prompt: string) => Promise<ArrayBuffer>;
    /** Generate a photographic image with the secondary provider (gpt-image-1). Returns PNG bytes. */
    generateSecondary: (prompt: string) => Promise<ArrayBuffer>;
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
 * Run the audit-driven retry ladder for a single photoreal image.
 *
 * When `constraint` is null/empty the audit is skipped (unconstrained persona):
 * the first successful photographic provider wins. When a constraint is set,
 * every photographic image must pass `audit` before it is accepted.
 *
 * Always resolves with a usable image (template fallback is last resort) unless
 * the template renderer itself throws — in which case it throws so the caller can
 * mark just that image failed.
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
        provider: 'imagen' | 'openai',
        attempt: number,
        prompt: string,
    ): Promise<ArrayBuffer | null> => {
        let image: ArrayBuffer;
        try {
            image = provider === 'imagen'
                ? await deps.generatePrimary(prompt)
                : await deps.generateSecondary(prompt);
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            attempts.push({ provider, attempt, outcome: 'error', detail: detail.slice(0, 200) });
            log(`[image] slide ${slide.slide}: ${provider} attempt ${attempt} error: ${detail.slice(0, 120)}`);
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
        log(`[image] slide ${slide.slide}: ${provider} attempt ${attempt} audit-rejected: ${verdict.reason ?? 'unspecified'}`);
        return null;
    };

    // ── Rung 1: Imagen 4 primary (bounded attempts) ──
    for (let i = 0; i < PRIMARY_ATTEMPTS; i++) {
        const prompt = strengthenPrompt(basePrompt, i);
        const image = await tryPhotographic('imagen', i + 1, prompt);
        if (image) {
            log(`[image] slide ${slide.slide}: produced by imagen (attempt ${i + 1})`);
            return { slide: slide.slide, imageBuffer: image, source: 'imagen', attempts };
        }
    }

    // ── Rung 2: gpt-image-1 secondary (bounded attempts, constraint-strengthened) ──
    for (let i = 0; i < SECONDARY_ATTEMPTS; i++) {
        // Continue strengthening past the primary attempts so each retry is harder.
        const prompt = strengthenPrompt(basePrompt, PRIMARY_ATTEMPTS + i);
        const image = await tryPhotographic('openai', i + 1, prompt);
        if (image) {
            log(`[image] slide ${slide.slide}: produced by openai (attempt ${i + 1})`);
            return { slide: slide.slide, imageBuffer: image, source: 'openai', attempts };
        }
    }

    // ── Rung 3: HUVA satori text template (non-photographic, no people) ──
    // Always compliant by construction, so it bypasses the audit legitimately.
    const templateImage = await deps.renderTemplate(slide);
    attempts.push({ provider: 'template', attempt: 1, outcome: 'used' });
    log(`[image] slide ${slide.slide}: produced by template fallback`);
    return { slide: slide.slide, imageBuffer: templateImage, source: 'template', attempts };
}
