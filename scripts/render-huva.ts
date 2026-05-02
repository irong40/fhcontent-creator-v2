/**
 * History Unveiled VA template renderer.
 *
 * Usage:
 *   tsx scripts/render-huva.ts hook-card '{"title":"...","hook":"...","location":"Petersburg, VA"}' out.png
 *
 * Templates live in templates/huva/. Brand kit lives in templates/huva/brand.css.
 * Renders 1080x1920 portrait PNGs using Playwright headless Chromium.
 *
 * Replaces Canva carousel/slide generation. Free, version-controlled, brand-perfect.
 */

import { chromium } from 'playwright';
import { readFile, writeFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates', 'huva');

function interpolate(html: string, vars: Record<string, string>): string {
    return html.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export async function renderHuvaTemplate(
    template: 'hook-card' | 'quote-slide' | 'end-card',
    vars: Record<string, string>,
    outputPath: string,
): Promise<void> {
    const templatePath = resolve(TEMPLATES_DIR, `${template}.html`);
    const html = await readFile(templatePath, 'utf-8');
    const filled = interpolate(html, vars);

    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: { width: 1080, height: 1920 },
            deviceScaleFactor: 2,
        });
        const page = await context.newPage();

        // Serve relative brand.css by setting base URL to the templates dir
        const baseUrl = pathToFileURL(TEMPLATES_DIR).href + '/';
        await page.setContent(filled, { waitUntil: 'networkidle' });
        await page.evaluate((b) => {
            const base = document.createElement('base');
            base.href = b;
            document.head.prepend(base);
        }, baseUrl);
        await page.waitForLoadState('networkidle');

        // Wait for fonts
        await page.evaluate(() => document.fonts.ready);

        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        await writeFile(outputPath, buffer);
    } finally {
        await browser.close();
    }
}

// CLI invocation
if (import.meta.url === `file://${process.argv[1]}`) {
    const [, , template, varsJson, outputPath] = process.argv;
    if (!template || !varsJson || !outputPath) {
        console.error('Usage: tsx scripts/render-huva.ts <template> <varsJson> <outputPath>');
        process.exit(1);
    }
    const vars = JSON.parse(varsJson);
    renderHuvaTemplate(template as 'hook-card' | 'quote-slide' | 'end-card', vars, outputPath)
        .then(() => console.log(`✔ Rendered ${template} → ${outputPath}`))
        .catch(err => {
            console.error('✖ Render failed:', err);
            process.exit(1);
        });
}
