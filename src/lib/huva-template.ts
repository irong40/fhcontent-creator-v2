/**
 * HUVA carousel template renderer (serverless-native).
 *
 * Renders the non-photographic HUVA carousel slide to a 1080x1080 PNG using
 * `satori` (HTML/flexbox → SVG) + `@resvg/resvg-js` (SVG → PNG). This runs
 * natively on the Vercel **node** serverless runtime with NO browser binary, so
 * it works in production where the previous Playwright/Chromium renderer threw.
 *
 * This is the deterministic, $0, never-fails carousel path: it contains ZERO
 * human figures, so it is compliant with any persona subject constraint by
 * construction and does not need the audit gate. See carousel-slide.ts for the
 * ladder that calls `renderHuvaSlide` (carousels render template-first).
 *
 * The HUVA brand kit (Heritage Navy ground, Old Gold accents, Cormorant
 * Garamond serif headline, Inter sans labels) is reproduced here directly from
 * templates/huva/brand.css so satori output matches the brand.
 */

import path from 'path';
import { readFileSync } from 'fs';
import type { CarouselSlide } from '@/types/database';

const HUVA_DIR = path.join(process.cwd(), 'templates', 'huva');
const TEMPLATE_PATH = path.join(HUVA_DIR, 'carousel-slide.html');
const FONT_DIR = path.join(process.cwd(), 'src', 'assets', 'fonts');

// ── HUVA brand tokens (mirrored from templates/huva/brand.css) ──
const HUVA = {
    navy: '#1F2F46',
    oldGold: '#C89B3C',
    parchment: '#F2E9D8',
    bone: '#E8DDCC',
    serif: 'Cormorant Garamond',
    sans: 'Inter',
} as const;

const CANVAS = 1080;

/** Replace `{{var}}` placeholders in the HUVA template. */
export function fillHuvaTemplate(
    html: string,
    vars: Record<string, string>,
): string {
    return html.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
        key in vars ? vars[key] : match,
    );
}

/**
 * Build the interpolated HTML for a single HUVA carousel slide. Retained for the
 * unit tests and for any consumer that wants the raw HTML; the production PNG
 * render path uses satori (`renderHuvaSlide`) and does not depend on this.
 *
 * The slide model carries `text` (one field); we surface it as the body and
 * derive a short headline from its leading clause so the template's title slot
 * is filled.
 */
export function buildHuvaSlideHtml(
    slide: CarouselSlide,
    slideTotal: number,
    options?: { eyebrow?: string; logoUrl?: string; logoClass?: string },
): string {
    const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
    const { headline, body } = deriveSlideCopy(slide);

    return fillHuvaTemplate(raw, {
        slide_n: String(slide.slide),
        slide_total: String(slideTotal),
        eyebrow: options?.eyebrow ?? 'History Unveiled VA',
        title: headline,
        body,
        logo_url: options?.logoUrl ?? 'assets/logo-1.png',
        logo_class: options?.logoClass ?? '',
    });
}

/**
 * Split the single-field slide text into a compact serif headline (first clause)
 * and a body. Shared by the HTML builder and the satori renderer so both produce
 * identical copy.
 */
function deriveSlideCopy(slide: CarouselSlide): { headline: string; body: string } {
    const text = (slide.text ?? '').trim();
    const headline = (text.split(/[.!?\n]/)[0] || `Slide ${slide.slide}`).slice(0, 80);
    const body = text.length > headline.length ? text : '';
    return { headline, body };
}

// ── Font loading (lazy, cached) ──
// satori needs embedded font buffers; system fonts are unavailable in serverless.
let fontCache: Array<{ name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: 'normal' }> | null = null;

function loadFonts() {
    if (fontCache) return fontCache;
    const f = (file: string) => readFileSync(path.join(FONT_DIR, file));
    fontCache = [
        { name: HUVA.sans, data: f('Inter-400.woff'), weight: 400, style: 'normal' },
        { name: HUVA.sans, data: f('Inter-500.woff'), weight: 500, style: 'normal' },
        { name: HUVA.sans, data: f('Inter-600.woff'), weight: 600, style: 'normal' },
        { name: HUVA.sans, data: f('Inter-700.woff'), weight: 700, style: 'normal' },
        { name: HUVA.serif, data: f('Cormorant-500.woff'), weight: 500, style: 'normal' },
        { name: HUVA.serif, data: f('Cormorant-600.woff'), weight: 600, style: 'normal' },
    ];
    return fontCache;
}

/**
 * Build the satori element tree for a HUVA carousel slide. Plain object form
 * (no JSX) so this stays a .ts file with no React/Babel transform.
 */
function buildSlideTree(
    slide: CarouselSlide,
    slideTotal: number,
    eyebrow: string,
): Record<string, unknown> {
    const { headline, body } = deriveSlideCopy(slide);

    const node = (
        style: Record<string, unknown>,
        children: unknown,
    ): Record<string, unknown> => ({ type: 'div', props: { style, children } });

    return node(
        {
            width: CANVAS,
            height: CANVAS,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: 88,
            backgroundColor: HUVA.navy,
            color: HUVA.parchment,
            fontFamily: HUVA.sans,
        },
        [
            // Header: eyebrow (left) + slide counter (right)
            node(
                { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
                [
                    node(
                        {
                            fontFamily: HUVA.sans,
                            fontWeight: 700,
                            fontSize: 28,
                            letterSpacing: 5,
                            textTransform: 'uppercase',
                            color: HUVA.oldGold,
                        },
                        eyebrow,
                    ),
                    node(
                        {
                            fontFamily: HUVA.sans,
                            fontWeight: 600,
                            fontSize: 22,
                            letterSpacing: 4,
                            textTransform: 'uppercase',
                            color: HUVA.oldGold,
                        },
                        `${slide.slide} / ${slideTotal}`,
                    ),
                ],
            ),
            // Main: serif headline (gold highlight) + sans body
            node(
                { display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1, paddingTop: 40, paddingBottom: 40 },
                [
                    node(
                        {
                            fontFamily: HUVA.serif,
                            fontWeight: 600,
                            fontSize: 104,
                            lineHeight: 1.08,
                            color: HUVA.oldGold,
                            marginBottom: 32,
                        },
                        headline,
                    ),
                    ...(body
                        ? [
                            node(
                                {
                                    fontFamily: HUVA.sans,
                                    fontWeight: 400,
                                    fontSize: 34,
                                    lineHeight: 1.42,
                                    color: HUVA.bone,
                                    maxWidth: 920,
                                },
                                body,
                            ),
                        ]
                        : []),
                ],
            ),
            // Footer: brand wordmark
            node(
                { display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end' },
                node(
                    {
                        fontFamily: HUVA.sans,
                        fontWeight: 500,
                        fontSize: 18,
                        letterSpacing: 3,
                        textTransform: 'uppercase',
                        color: HUVA.oldGold,
                    },
                    'History Unveiled VA',
                ),
            ),
        ],
    );
}

/**
 * Render a HUVA carousel slide to PNG bytes (1080x1080) via satori + resvg.
 * Serverless-native (no browser). Returns a standalone ArrayBuffer.
 */
export async function renderHuvaSlide(
    slide: CarouselSlide,
    slideTotal: number,
    options?: { eyebrow?: string; logoUrl?: string; logoClass?: string },
): Promise<ArrayBuffer> {
    // Dynamic imports keep satori/resvg out of cold-start cost for routes that
    // never render a template, and out of the edge bundle entirely.
    const satori = (await import('satori')).default;
    const { Resvg } = await import('@resvg/resvg-js');

    const eyebrow = options?.eyebrow ?? 'History Unveiled VA';
    const tree = buildSlideTree(slide, slideTotal, eyebrow);

    const svg = await satori(tree as never, {
        width: CANVAS,
        height: CANVAS,
        fonts: loadFonts(),
    });

    const png = new Resvg(svg, {
        fitTo: { mode: 'width', value: CANVAS },
        background: HUVA.navy,
    }).render().asPng();

    // Return a standalone ArrayBuffer (avoid leaking a pooled Buffer's backing store).
    return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}
