/**
 * Local smoke test for the quote card template (quote_video personas).
 * Renders a sample Freedom Voices card to tmp/quote_card_test.png.
 * Run with: npx tsx scripts/render-quote-card-test.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { renderQuoteCard } from '../src/lib/quote-template';

async function main() {
    const png = await renderQuoteCard({
        quote: 'If there is no struggle there is no progress. Those who profess to favor freedom and yet deprecate agitation are men who want crops without plowing up the ground; they want rain without thunder and lightning. They want the ocean without the awful roar of its many waters.',
        attribution: 'Frederick Douglass',
        source: 'West India Emancipation speech',
        year: '1857',
        brandMark: 'Freedom Voices',
    });

    const outDir = path.join(process.cwd(), 'tmp');
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'quote_card_test.png');
    writeFileSync(outPath, Buffer.from(png));
    console.log(`Rendered ${png.byteLength} bytes → ${outPath}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
