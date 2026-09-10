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
import { sniffImageMime } from '@/lib/utils';
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
    if (!text) return { headline: `Slide ${slide.slide}`, body: '' };

    // Where the headline ends: an explicit line break wins (HUVA copy is often
    // written as "TITLE\n\nsubtitle\n\ndates"), otherwise the first sentence.
    const newline = text.indexOf('\n');
    const sentence = text.match(/^[\s\S]{20,160}?[.!?](\s|$)/);
    let cut = -1;
    if (newline > 0 && newline <= 120) cut = newline;
    else if (sentence) cut = sentence[0].length;

    let headline: string;
    let body: string;
    if (cut > 0) {
        headline = text.slice(0, cut).trim();
        body = text.slice(cut).trim();
    } else if (text.length <= 90) {
        headline = text;
        body = '';
    } else {
        // Long unbroken text: cut on a word boundary so the headline never ends
        // mid-word, and carry the remainder into the body.
        const space = text.lastIndexOf(' ', 90);
        headline = text.slice(0, space > 40 ? space : 90).trim();
        body = text.slice(headline.length).trim();
    }

    // The body must never restate the headline — that duplication is what made
    // the old slides read as the same sentence printed twice.
    if (body && body.toLowerCase().startsWith(headline.toLowerCase())) {
        body = body.slice(headline.length).trim();
    }
    return { headline: headline.replace(/[\s:;,—-]+$/, ''), body };
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
/** An archival photograph to sit behind the slide typography. */
export interface SlidePhoto {
    /** JPEG bytes of the photograph. */
    bytes: ArrayBuffer;
    /** Attribution rendered along the bottom of the slide. Always shown. */
    credit: string;
}

function buildSlideTree(
    slide: CarouselSlide,
    slideTotal: number,
    eyebrow: string,
    photo?: SlidePhoto,
): Record<string, unknown> {
    const { headline, body } = deriveSlideCopy(slide);

    const node = (
        style: Record<string, unknown>,
        children: unknown,
    ): Record<string, unknown> => ({ type: 'div', props: { style, children } });

    // Photo slides drop the headline size: the type sits over image detail
    // rather than flat colour, so it needs breathing room more than scale.
    // Long headlines step down further so they cannot crowd out the photograph.
    const baseSize = photo ? 84 : 104;
    const headlineSize = headline.length > 90 ? baseSize - 24
        : headline.length > 55 ? baseSize - 12
            : baseSize;

    const layers: unknown[] = [];
    if (photo) {
        // The format must be read from the bytes: archival derivatives are JPEG,
        // gpt-image-1 returns PNG, and satori throws parsing a mislabelled image.
        const dataUri = `data:${sniffImageMime(photo.bytes)};base64,${Buffer.from(photo.bytes).toString('base64')}`;
        // Layer 1 — the photograph, cover-cropped to the square canvas.
        layers.push({
            type: 'img',
            props: {
                src: dataUri,
                width: CANVAS,
                height: CANVAS,
                style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: CANVAS,
                    height: CANVAS,
                    objectFit: 'cover',
                },
            },
        });
        // Layer 2 — navy scrim. Light at the top so the image reads, heavy at
        // the bottom where the headline and credit sit.
        layers.push(
            node(
                {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: CANVAS,
                    height: CANVAS,
                    display: 'flex',
                    // Kept deliberately light through the upper half: the whole
                    // point of the archival photograph is that it can be seen.
                    // It deepens only where the headline and credit sit.
                    backgroundImage:
                        'linear-gradient(180deg, rgba(31,47,70,0.18) 0%, rgba(31,47,70,0.34) 38%, rgba(18,28,44,0.86) 78%, rgba(18,28,44,0.94) 100%)',
                },
                [],
            ),
        );
    }

    const content = node(
        {
            position: photo ? 'absolute' : 'relative',
            top: 0,
            left: 0,
            width: CANVAS,
            height: CANVAS,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: 88,
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
            // Main: serif headline (gold highlight) + sans body.
            // Over a photograph the block sits low, where the scrim is heaviest.
            node(
                {
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: photo ? 'flex-end' : 'center',
                    flexGrow: 1,
                    paddingTop: 40,
                    paddingBottom: 40,
                },
                [
                    node(
                        {
                            fontFamily: HUVA.serif,
                            fontWeight: 600,
                            fontSize: headlineSize,
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
            // Footer: archival credit (left) + brand wordmark (right).
            // The credit is mandatory whenever a photograph is used — it carries
            // the source AND the catalog date, so an illustrative pairing is
            // never mistaken for a literal depiction of the story being told.
            node(
                {
                    display: 'flex',
                    justifyContent: photo ? 'space-between' : 'flex-end',
                    alignItems: 'flex-end',
                },
                [
                    ...(photo
                        ? [
                            node(
                                {
                                    fontFamily: HUVA.sans,
                                    fontWeight: 400,
                                    fontSize: 17,
                                    letterSpacing: 1,
                                    color: HUVA.bone,
                                    opacity: 0.82,
                                    maxWidth: 620,
                                },
                                photo.credit,
                            ),
                        ]
                        : []),
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
                ],
            ),
        ],
    );

    return node(
        {
            position: 'relative',
            width: CANVAS,
            height: CANVAS,
            display: 'flex',
            backgroundColor: HUVA.navy,
        },
        [...layers, content],
    );
}

/**
 * Render a HUVA carousel slide to PNG bytes (1080x1080) via satori + resvg.
 * Serverless-native (no browser). Returns a standalone ArrayBuffer.
 */
export async function renderHuvaSlide(
    slide: CarouselSlide,
    slideTotal: number,
    options?: { eyebrow?: string; logoUrl?: string; logoClass?: string; photo?: SlidePhoto },
): Promise<ArrayBuffer> {
    // Dynamic imports keep satori/resvg out of cold-start cost for routes that
    // never render a template, and out of the edge bundle entirely.
    const satori = (await import('satori')).default;
    const { Resvg } = await import('@resvg/resvg-js');

    const eyebrow = options?.eyebrow ?? 'History Unveiled VA';
    const tree = buildSlideTree(slide, slideTotal, eyebrow, options?.photo);

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
