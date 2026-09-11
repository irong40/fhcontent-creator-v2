import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateLocalDraft } from '../src/lib/local-content-draft';

async function main() {
    const [inputPath, outputPath, ...extra] = process.argv.slice(2);
    if (!inputPath || !outputPath || extra.length) throw new Error('Usage: npx tsx scripts/local-content-draft.ts source-packet.json draft.json');
    if (resolve(inputPath) === resolve(outputPath)) throw new Error('Output must not overwrite the source packet');
    const packet = JSON.parse(await readFile(inputPath, 'utf8'));
    const result = await generateLocalDraft(packet);
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(`Local draft saved for review: ${outputPath}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Local draft failed'); process.exitCode = 1; });
