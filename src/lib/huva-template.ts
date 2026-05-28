/**
 * HUVA carousel template renderer.
 *
 * Renders the non-photographic `templates/huva/carousel-slide.html` template to a
 * 1080x1080 PNG via Playwright (Chromium). This is the last-resort carousel slide
 * fallback for image-constrained personas: it contains ZERO human figures, so it
 * is compliant with the subject constraint by construction and does not need the
 * audit gate.
 *
 * Cost: $0 (local headless render). See carousel-slide.ts for the retry ladder
 * that calls this only after DALL-E and Gemini have been exhausted.
 */

import path from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import type { CarouselSlide } from '@/types/database';

const HUVA_DIR = path.join(process.cwd(), 'templates', 'huva');
const TEMPLATE_PATH = path.join(HUVA_DIR, 'carousel-slide.html');

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
 * Build the interpolated HTML for a single HUVA carousel slide. Split out from the
 * Playwright call so it can be unit-tested without launching a browser.
 *
 * The slide model carries `text` (one field); we surface it as the body and derive
 * a short headline from its leading clause so the template's title slot is filled.
 */
export function buildHuvaSlideHtml(
    slide: CarouselSlide,
    slideTotal: number,
    options?: { eyebrow?: string; logoUrl?: string; logoClass?: string },
): string {
    const raw = readFileSync(TEMPLATE_PATH, 'utf-8');
    const text = (slide.text ?? '').trim();
    // Derive a compact headline from the first sentence/clause; fall back to a label.
    const headline = (text.split(/[.!?\n]/)[0] || `Slide ${slide.slide}`).slice(0, 80);
    const body = text.length > headline.length ? text : '';

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
 * Render a HUVA carousel slide to PNG bytes (1080x1080) via Playwright.
 * Relative asset/css URLs resolve against the templates/huva/ directory.
 */
export async function renderHuvaSlide(
    slide: CarouselSlide,
    slideTotal: number,
    options?: { eyebrow?: string; logoUrl?: string; logoClass?: string },
): Promise<ArrayBuffer> {
    // Dynamic import keeps Playwright out of the bundle for non-fallback runs.
    const { chromium } = await import('playwright');
    const html = buildHuvaSlideHtml(slide, slideTotal, options);

    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
        // baseURL so the template's relative brand.css and assets/ resolve locally.
        await page.goto(pathToFileURL(path.join(HUVA_DIR, 'index.html')).href, { waitUntil: 'commit' }).catch(() => {});
        await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
        const buffer = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1080 } });
        // Node Buffer → ArrayBuffer slice (avoid returning a shared pool buffer).
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    } finally {
        await browser.close();
    }
}
