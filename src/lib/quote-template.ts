/**
 * Quote card template renderer (serverless-native) for quote_video personas.
 *
 * Renders a single 1080x1920 portrait quote card to PNG via `satori` +
 * `@resvg/resvg-js` — the same deterministic, $0, no-browser path as
 * huva-template.ts. The card contains ZERO human figures, so it is compliant
 * with any persona subject constraint by construction.
 *
 * Loop strategy context: this still frame becomes a <5s looping video (music
 * loop added by the local renderer on the music machine). The quote is 35-60
 * words and takes 10s+ to read, so platforms replay the clip and count each
 * loop as a view. The card must therefore be comfortably readable at phone
 * size: large serif type, generous margins, high contrast.
 */

import path from 'path';
import { readFileSync } from 'fs';

const FONT_DIR = path.join(process.cwd(), 'src', 'assets', 'fonts');

// ── Brand tokens — HUVA heritage palette (history content family) ──
const TOKENS = {
    ink: '#16202F',        // deepened Heritage Navy ground
    navy: '#1F2F46',
    oldGold: '#C89B3C',
    parchment: '#F2E9D8',
    bone: '#E8DDCC',
    serif: 'Cormorant Garamond',
    sans: 'Inter',
} as const;

export const QUOTE_CANVAS = { width: 1080, height: 1920 } as const;

/** Structured card data, sourced from the topic's historical point 1. */
export interface QuoteCard {
    /** Verbatim quote text, no surrounding quotation marks (the template adds them). */
    quote: string;
    /** Figure name, e.g. "Frederick Douglass". */
    attribution: string;
    /** Where the quote comes from, e.g. "West India Emancipation speech". */
    source?: string;
    /** Year said/written. */
    year?: string;
    /** Small caps line at the top of the card. Defaults to the brand mark. */
    eyebrow?: string;
    /** Brand wordmark at the bottom of the card. */
    brandMark?: string;
}

/**
 * Pick a quote font size that keeps 35-60 word quotes inside the safe area.
 * Sizes were chosen against satori line metrics at 904px of text width.
 */
export function quoteFontSize(quote: string): number {
    const chars = quote.length;
    if (chars <= 200) return 64;
    if (chars <= 280) return 56;
    if (chars <= 360) return 50;
    return 44;
}

// ── Font loading (lazy, cached) — satori needs embedded font buffers ──
let fontCache: Array<{ name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: 'normal' }> | null = null;

function loadFonts() {
    if (fontCache) return fontCache;
    const f = (file: string) => readFileSync(path.join(FONT_DIR, file));
    fontCache = [
        { name: TOKENS.sans, data: f('Inter-400.woff'), weight: 400, style: 'normal' },
        { name: TOKENS.sans, data: f('Inter-500.woff'), weight: 500, style: 'normal' },
        { name: TOKENS.sans, data: f('Inter-600.woff'), weight: 600, style: 'normal' },
        { name: TOKENS.sans, data: f('Inter-700.woff'), weight: 700, style: 'normal' },
        { name: TOKENS.serif, data: f('Cormorant-500.woff'), weight: 500, style: 'normal' },
        { name: TOKENS.serif, data: f('Cormorant-600.woff'), weight: 600, style: 'normal' },
    ];
    return fontCache;
}

/** Satori element tree for the quote card. Plain object form — no JSX. */
export function buildQuoteCardTree(card: QuoteCard): Record<string, unknown> {
    const node = (
        style: Record<string, unknown>,
        children: unknown,
    ): Record<string, unknown> => ({ type: 'div', props: { style, children } });

    const eyebrow = card.eyebrow ?? card.brandMark ?? 'Freedom Voices';
    const brandMark = card.brandMark ?? 'Freedom Voices';
    const attributionLine = `— ${card.attribution}`;
    const sourceLine = [card.source, card.year].filter(Boolean).join(', ');

    return node(
        {
            width: QUOTE_CANVAS.width,
            height: QUOTE_CANVAS.height,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: 88,
            backgroundColor: TOKENS.ink,
            color: TOKENS.parchment,
            fontFamily: TOKENS.sans,
        },
        [
            // Header: eyebrow centered over a thin gold rule
            node(
                { display: 'flex', flexDirection: 'column', alignItems: 'center' },
                [
                    node(
                        {
                            fontFamily: TOKENS.sans,
                            fontWeight: 700,
                            fontSize: 30,
                            letterSpacing: 8,
                            textTransform: 'uppercase',
                            color: TOKENS.oldGold,
                            marginBottom: 24,
                        },
                        eyebrow,
                    ),
                    node({ width: 120, height: 3, display: 'flex', backgroundColor: TOKENS.oldGold }, undefined),
                ],
            ),
            // Main: oversized opening quote mark + serif quote + attribution
            node(
                { display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1, paddingTop: 48, paddingBottom: 48 },
                [
                    node(
                        {
                            fontFamily: TOKENS.serif,
                            fontWeight: 600,
                            fontSize: 160,
                            lineHeight: 0.6,
                            color: TOKENS.oldGold,
                            marginBottom: 8,
                        },
                        '“',
                    ),
                    node(
                        {
                            fontFamily: TOKENS.serif,
                            fontWeight: 500,
                            fontSize: quoteFontSize(card.quote),
                            lineHeight: 1.32,
                            color: TOKENS.parchment,
                            marginBottom: 56,
                        },
                        card.quote,
                    ),
                    node(
                        {
                            fontFamily: TOKENS.sans,
                            fontWeight: 600,
                            fontSize: 38,
                            letterSpacing: 2,
                            color: TOKENS.oldGold,
                            marginBottom: sourceLine ? 12 : 0,
                        },
                        attributionLine,
                    ),
                    ...(sourceLine
                        ? [
                            node(
                                {
                                    fontFamily: TOKENS.sans,
                                    fontWeight: 400,
                                    fontSize: 26,
                                    letterSpacing: 1,
                                    color: TOKENS.bone,
                                },
                                sourceLine,
                            ),
                        ]
                        : []),
                ],
            ),
            // Footer: brand wordmark centered
            node(
                { display: 'flex', justifyContent: 'center' },
                node(
                    {
                        fontFamily: TOKENS.sans,
                        fontWeight: 500,
                        fontSize: 20,
                        letterSpacing: 4,
                        textTransform: 'uppercase',
                        color: TOKENS.oldGold,
                    },
                    brandMark,
                ),
            ),
        ],
    );
}

/**
 * Render the quote card to PNG bytes (1080x1920) via satori + resvg.
 * Serverless-native (no browser). Returns a standalone ArrayBuffer.
 */
export async function renderQuoteCard(card: QuoteCard): Promise<ArrayBuffer> {
    const satori = (await import('satori')).default;
    const { Resvg } = await import('@resvg/resvg-js');

    const tree = buildQuoteCardTree(card);

    const svg = await satori(tree as never, {
        width: QUOTE_CANVAS.width,
        height: QUOTE_CANVAS.height,
        fonts: loadFonts(),
    });

    const png = new Resvg(svg, {
        fitTo: { mode: 'width', value: QUOTE_CANVAS.width },
        background: TOKENS.ink,
    }).render().asPng();

    return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}
