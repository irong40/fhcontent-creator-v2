/**
 * History Unveiled VA template renderer with anthology logo rotation.
 *
 * Usage:
 *   tsx scripts/render-huva.ts hook-card 1 '{"title":"...","hook":"...","location":"Petersburg, VA"}' out.png
 *
 * Logo variants (anthology rotation, assigned per topic by DB trigger):
 *   1 = refined wordmark (Concept 1)
 *   2 = HUVA monogram (Concept 2) — also gets the .huva-anchor__logo--seal class
 *   3 = torn-parchment social icon (Concept 3) — circular, treated as seal
 *
 * Templates: templates/huva/. Brand kit: templates/huva/brand.css.
 * Renders 1080x1920 portrait PNGs via Playwright headless Chromium.
 */

import { chromium } from 'playwright';
import { readFile, writeFile, unlink } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates', 'huva');
const ASSETS_DIR = resolve(TEMPLATES_DIR, 'assets');

export type LogoVariant = 1 | 2 | 3;
export type HuvaTemplate = 'hook-card' | 'quote-slide' | 'end-card';

function interpolate(html: string, vars: Record<string, string>): string {
    return html.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function logoAssetFor(variant: LogoVariant): { url: string; cssClass: string } {
    // Relative path — the temp HTML lives in TEMPLATES_DIR, so assets/logo-N.png resolves natively.
    const url = `assets/logo-${variant}.png`;
    // All three logo PNGs are already finished marks (Concept 3 is its own circular badge);
    // the default .huva-anchor__logo class with object-fit:contain handles all three correctly.
    return { url, cssClass: '' };
}

export async function renderHuvaTemplate(
    template: HuvaTemplate,
    logoVariant: LogoVariant,
    vars: Record<string, string>,
    outputPath: string,
): Promise<void> {
    const templatePath = resolve(TEMPLATES_DIR, `${template}.html`);
    const html = await readFile(templatePath, 'utf-8');

    const logo = logoAssetFor(logoVariant);
    const filled = interpolate(html, {
        ...vars,
        logo_url: logo.url,
        logo_class: logo.cssClass,
    });

    // Write rendered HTML to a temp file inside TEMPLATES_DIR so relative
    // hrefs (brand.css, assets/*) resolve natively under file:// origin.
    const tmpName = `.render-${crypto.randomBytes(6).toString('hex')}.html`;
    const tmpPath = resolve(TEMPLATES_DIR, tmpName);
    await writeFile(tmpPath, filled);

    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: { width: 1080, height: 1920 },
            deviceScaleFactor: 2,
        });
        const page = await context.newPage();

        const fileUrl = pathToFileURL(tmpPath).href;
        await page.goto(fileUrl, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);

        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        await writeFile(outputPath, buffer);
    } finally {
        await browser.close();
        await unlink(tmpPath).catch(() => {});
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const [, , template, variantStr, varsJson, outputPath] = process.argv;
    if (!template || !variantStr || !varsJson || !outputPath) {
        console.error('Usage: tsx scripts/render-huva.ts <template> <variant 1|2|3> <varsJson> <outputPath>');
        process.exit(1);
    }
    const variant = parseInt(variantStr, 10) as LogoVariant;
    if (![1, 2, 3].includes(variant)) {
        console.error(`Invalid variant ${variantStr} — must be 1, 2, or 3`);
        process.exit(1);
    }
    const vars = JSON.parse(varsJson);
    renderHuvaTemplate(template as HuvaTemplate, variant, vars, outputPath)
        .then(() => console.log(`✔ Rendered ${template} (logo variant ${variant}) → ${outputPath}`))
        .catch(err => {
            console.error('✖ Render failed:', err);
            process.exit(1);
        });
}
