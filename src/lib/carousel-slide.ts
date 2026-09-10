/**
 * Slide/thumbnail image production — audit-driven provider ladder.
 *
 * Every image is produced by an explicit, bounded ladder:
 *   1. Archival  → real public-domain LOC photograph    → audit. Pass ⇒ use it.
 *   2. Generated → provider cascade, photoreal          → audit.
 *   3. Generated → retry with a strengthened prompt     → audit.
 *   4. HUVA satori text template (no people) — always passes, $0, never fails.
 *
 * ── Why there is no Imagen rung ─────────────────────────────────────────────
 * Imagen 4 was the primary provider until 2026-07-28. It is dead:
 * `imagen-4.0-generate-001` (and the -fast/-ultra siblings) return HTTP 404
 * "no longer available to new users". Live telemetry showed 382 Imagen attempts
 * and 382 errors since 2026-06-02 — every image silently cost two wasted
 * round-trips before falling through. The rung is removed rather than retried.
 *
 * ── The generated rung is a cascade, not one provider ───────────────────────
 * On 2026-07-30 the sole remaining generative provider was ALSO dead (zero
 * OpenAI credits), so every photoreal image fell through to the text template
 * and nothing alerted — the last rung always succeeds, so the ladder reported
 * success while producing exactly the all-words output it exists to avoid.
 * `generatePhoto` is now supplied by `photo-provider.ts`, which tries
 * gemini-3.1-flash-image then gpt-image-1.
 *
 * The older note that "every Gemini image model returns 429" was true only of
 * the original unbilled Google project. Gemini image generation works on the
 * project in use since 2026-07-30.
 *
 * ── Audit discipline ────────────────────────────────────────────────────────
 * Both photographic rungs are audited against the persona subject constraint.
 * Archival images are NOT exempt: a period photograph of a strike or a factory
 * floor may well contain white bystanders, and the catalog holds caricature
 * material that a naive subject check would wave through. Only the
 * non-photographic template bypasses the audit, and it does so legitimately
 * because it renders zero human figures.
 *
 * The orchestrator takes all I/O as injected dependencies so it is fully
 * unit-testable without live API calls.
 */

import type { CarouselSlide } from '@/types/database';

/** Max gpt-image-1 attempts before falling through to the template. */
export const PHOTO_ATTEMPTS = 2;

export type SlideProvider = 'archival' | 'openai' | 'template';

/** Credit shown on slides built from a generated image rather than a record. */
export const AI_IMAGE_CREDIT = 'Illustration · AI-generated';

export interface SlideAttemptLog {
    provider: SlideProvider;
    attempt: number;
    /** 'used' = produced the final image; 'rejected' = audit failed; 'error' = provider threw. */
    outcome: 'used' | 'rejected' | 'error';
    detail?: string;
}

/** A real archival photograph plus the attribution that must travel with it. */
export interface ArchivalPick {
    bytes: ArrayBuffer;
    credit: string;
    title?: string;
    sourceUrl?: string;
}

export interface SlideResult {
    slide: number;
    /** Image bytes that won: a photograph, or the pre-rendered template card. */
    imageBuffer: ArrayBuffer;
    /** Which provider produced the winning image. */
    source: SlideProvider;
    /**
     * Attribution for the winning image, when one applies. Callers compositing
     * a photograph into a slide MUST render this. Absent for the template rung.
     */
    credit?: string;
    /** Catalog provenance, present only for the archival rung. */
    sourceUrl?: string;
    /** Per-attempt trace for logging / observability. */
    attempts: SlideAttemptLog[];
}

export interface AuditResult {
    pass: boolean;
    reason?: string;
}

/**
 * Flatten the attempt trace into plain JSON for the `visual_assets.metadata`
 * column. The interface has no index signature, so it is not assignable to the
 * generated `Json` type directly.
 */
export function serializeAttempts(attempts: SlideAttemptLog[]): Record<string, string | number>[] {
    return attempts.map(a => ({
        provider: a.provider,
        attempt: a.attempt,
        outcome: a.outcome,
        ...(a.detail ? { detail: a.detail } : {}),
    }));
}

/** Injected I/O for the slide ladder. */
export interface SlideLadderDeps {
    /**
     * Supply a rights-cleared archival photograph for this slide, or null when
     * the catalog has nothing. Omit the dep entirely for non-archival personas.
     */
    generateArchival?: (slide: CarouselSlide) => Promise<ArchivalPick | null>;
    /** Generate a photoreal image with gpt-image-1. Returns PNG/JPEG bytes. */
    generatePhoto: (prompt: string) => Promise<ArrayBuffer>;
    /** Audit an image against the persona subject constraint. */
    audit: (image: ArrayBuffer, constraint: string) => Promise<AuditResult>;
    /** Render the non-photographic HUVA text template. Returns PNG bytes. */
    renderTemplate: (slide: CarouselSlide) => Promise<ArrayBuffer>;
    /** Apply the persona subject guardrail to a base prompt (no-op when unset). */
    applyGuardrail: (prompt: string, constraint: string | null | undefined) => string;
    /**
     * Extra audit language for archival images (caricature / off-subject /
     * degrading material). Appended to the persona constraint on rung 1 only.
     */
    archivalAuditRules?: string;
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
 * Run the audit-driven ladder for a single image.
 *
 * When `constraint` is null/empty the audit is skipped (unconstrained persona)
 * and the first successful provider wins. When a constraint is set, every
 * photographic image — archival included — must pass `audit` before acceptance.
 *
 * Always resolves with a usable image (the template is the last resort) unless
 * the template renderer itself throws, in which case it throws so the caller can
 * mark just that image failed.
 */
export async function generateSlideWithLadder(
    slide: CarouselSlide,
    constraint: string | null | undefined,
    deps: SlideLadderDeps,
): Promise<SlideResult> {
    const log = deps.log ?? ((m: string) => console.log(m));
    const attempts: SlideAttemptLog[] = [];

    // ── Rung 1: real archival photography ──
    if (deps.generateArchival) {
        try {
            const pick = await deps.generateArchival(slide);
            if (pick) {
                let verdict: AuditResult = { pass: true };
                if (constraint) {
                    // Archival material needs the caricature / off-subject rules
                    // on top of the persona's own subject constraint.
                    const archivalConstraint = deps.archivalAuditRules
                        ? `${constraint}\n\n${deps.archivalAuditRules}`
                        : constraint;
                    verdict = await deps.audit(pick.bytes, archivalConstraint);
                }
                if (verdict.pass) {
                    attempts.push({ provider: 'archival', attempt: 1, outcome: 'used' });
                    log(`[image] slide ${slide.slide}: archival — ${pick.credit}`);
                    return {
                        slide: slide.slide,
                        imageBuffer: pick.bytes,
                        source: 'archival',
                        credit: pick.credit,
                        sourceUrl: pick.sourceUrl,
                        attempts,
                    };
                }
                attempts.push({ provider: 'archival', attempt: 1, outcome: 'rejected', detail: verdict.reason });
                log(`[image] slide ${slide.slide}: archival audit-rejected: ${verdict.reason ?? 'unspecified'}`);
            }
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            attempts.push({ provider: 'archival', attempt: 1, outcome: 'error', detail: detail.slice(0, 200) });
            log(`[image] slide ${slide.slide}: archival error: ${detail.slice(0, 120)}`);
        }
    }

    // ── Rung 2: gpt-image-1 (bounded attempts, constraint-strengthened) ──
    const basePrompt = deps.applyGuardrail(slide.imagePrompt, constraint);
    for (let i = 0; i < PHOTO_ATTEMPTS; i++) {
        const prompt = strengthenPrompt(basePrompt, i);
        let image: ArrayBuffer;
        try {
            image = await deps.generatePhoto(prompt);
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            attempts.push({ provider: 'openai', attempt: i + 1, outcome: 'error', detail: detail.slice(0, 200) });
            log(`[image] slide ${slide.slide}: openai attempt ${i + 1} error: ${detail.slice(0, 120)}`);
            continue;
        }

        if (!constraint) {
            attempts.push({ provider: 'openai', attempt: i + 1, outcome: 'used' });
            log(`[image] slide ${slide.slide}: produced by openai (attempt ${i + 1})`);
            return { slide: slide.slide, imageBuffer: image, source: 'openai', credit: AI_IMAGE_CREDIT, attempts };
        }

        const verdict = await deps.audit(image, constraint);
        if (verdict.pass) {
            attempts.push({ provider: 'openai', attempt: i + 1, outcome: 'used' });
            log(`[image] slide ${slide.slide}: produced by openai (attempt ${i + 1})`);
            return { slide: slide.slide, imageBuffer: image, source: 'openai', credit: AI_IMAGE_CREDIT, attempts };
        }
        attempts.push({ provider: 'openai', attempt: i + 1, outcome: 'rejected', detail: verdict.reason });
        log(`[image] slide ${slide.slide}: openai attempt ${i + 1} audit-rejected: ${verdict.reason ?? 'unspecified'}`);
    }

    // ── Rung 3: HUVA satori text template (non-photographic, no people) ──
    const templateImage = await deps.renderTemplate(slide);
    attempts.push({ provider: 'template', attempt: 1, outcome: 'used' });
    log(`[image] slide ${slide.slide}: produced by template fallback`);
    return { slide: slide.slide, imageBuffer: templateImage, source: 'template', attempts };
}
