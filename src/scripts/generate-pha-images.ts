/**
 * Generate PHA-themed DALL-E images for the St. John's lecture.
 * Color palette: royal purple, gold, black, warm candlelight.
 */

import * as fs from 'fs';
import * as path from 'path';

const IMAGES = [
    {
        name: 'gen-intro-bg.png',
        prompt: 'Cinematic wide shot of an ornate Masonic lodge altar at dusk, deep royal purple walls and drapery, gold candlesticks with flickering warm candlelight, black and white checkered floor, gold square and compass prominently displayed on open Volume of Sacred Law, dramatic chiaroscuro lighting, royal purple and gold color palette, photorealistic, 1792x1024 aspect ratio, reverent atmosphere, no people, no text, no modern elements',
    },
    {
        name: 'gen-medieval-stonemasons.png',
        prompt: 'Medieval European stonemasons working on a gothic cathedral at sunset, warm purple and gold sky, golden hour lighting on carved stone, weathered parchment with architectural drawings, compass and square tools, royal purple and gold tones dominate the atmosphere, historical oil painting style, 1792x1024 cinematic, no text, no modern elements',
    },
    {
        name: 'gen-two-saints-solstice.png',
        prompt: 'Allegorical illustration of the two Saints John and the solstices, summer sun and winter sun as gold discs on royal purple background, point within a circle flanked by two parallel lines, gold symbolic rays, royal purple and gold Masonic color palette, dignified allegorical art style, 1792x1024, no text, no figures',
    },
    {
        name: 'gen-1717-tavern.png',
        prompt: '18th century London tavern interior at night, the Goose and Gridiron Ale House, warm candlelight and fireplace glow with subtle royal purple shadows, gentlemen in period dress gathered around wooden tables with aged parchment and pewter tankards, historically accurate, cinematic wide shot, 1792x1024, no modern elements, no text',
    },
    {
        name: 'gen-1775-military-lodge.png',
        prompt: 'Revolutionary War era 1775, British military lodge meeting in a field tent at night, African American men in 18th century attire being received as Masons, warm lantern light with royal purple tent interior and gold-trimmed Masonic altar, candlelit, dignified and historically significant atmosphere, photorealistic oil painting style, 1792x1024, no text',
    },
    {
        name: 'gen-boston-procession-1780s.png',
        prompt: '1780s Boston street scene, African American Masons in full period regalia with white aprons and royal purple and gold sashes, dignified procession on St. John\'s Day, colonial brick buildings, warm afternoon light, historical oil painting style, royal purple and gold color accents, 1792x1024, no text, no modern elements',
    },
    {
        name: 'gen-independent-chronicle-1782.png',
        prompt: 'Aged 1782 newspaper page, The Independent Chronicle of Boston, weathered yellowed paper with period typography, quill pen resting on the page, candlelight with royal purple shadows, warm gold highlights, historical document photography style, 1792x1024, minimal visible text is period-appropriate only',
    },
    {
        name: 'gen-charter-1784.png',
        prompt: 'Ornate 1784 Masonic charter parchment document with gold wax seal and royal purple ribbon, aged weathered parchment, calligraphic period script illegibly rendered, gold seal embossed with Masonic imagery, candlelight glow with warm amber and royal purple tones, photorealistic still life, 1792x1024, no modern text',
    },
    {
        name: 'gen-marrant-sermon-1789.png',
        prompt: '1789 colonial African American preacher at wooden pulpit in meeting house, warm candlelight, congregation of Black Masons in period regalia with royal purple and gold sashes, dignified historical scene, oil painting style, golden hour light streaming through windows, 1792x1024, no text, no modern elements',
    },
    {
        name: 'gen-menotomy-1797.png',
        prompt: '1797 Massachusetts country meeting house at sunset, dignified elderly African American Mason giving a charge to brethren in period Masonic regalia, warm golden hour light with royal purple dusk sky, brick and white clapboard New England architecture, oil painting historical style, 1792x1024, no text, no modern elements',
    },
    {
        name: 'gen-richmond-1865-convention.png',
        prompt: 'October 1865 Richmond Virginia post-Civil War, dignified African American Masons in dark Victorian suits gathered in a meeting hall for Grand Lodge convention, Reconstruction era, warm lamplight with royal purple drapery and gold Masonic symbols, sepia-toned historical photograph aesthetic with subtle purple and gold color wash, 1792x1024, no text, no modern elements',
    },
    {
        name: 'gen-virginia-lodge-interior.png',
        prompt: 'Contemporary Prince Hall Masonic lodge room in Virginia, warm lamplight, royal purple drapery and gold embroidered Masonic symbols on walls, black and white checkered floor, Volume of Sacred Law on altar with gold square and compass, empty but reverent atmosphere, photorealistic, 1792x1024, no people, no text',
    },
];

async function generateImage(prompt: string, apiKey: string): Promise<Buffer> {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size: '1792x1024',
            quality: 'hd',
            response_format: 'b64_json',
        }),
    });

    if (!resp.ok) {
        throw new Error(`DALL-E error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json();
    return Buffer.from(data.data[0].b64_json, 'base64');
}

async function main() {
    const outDir = path.join('D:', 'Projects', 'sai-training-videos', 'public', 'mwphglva', 'generated');
    fs.mkdirSync(outDir, { recursive: true });

    for (const img of IMAGES) {
        const outPath = path.join(outDir, img.name);
        if (fs.existsSync(outPath)) {
            console.log(`Skipping (exists): ${img.name}`);
            continue;
        }

        console.log(`Generating ${img.name}...`);
        try {
            const buffer = await generateImage(img.prompt, process.env.OPENAI_API_KEY!);
            fs.writeFileSync(outPath, buffer);
            console.log(`  Saved: ${(buffer.length / 1024).toFixed(0)} KB`);
        } catch (e) {
            console.error(`  Failed: ${(e as Error).message}`);
        }
    }

    console.log('\nAll PHA-themed images generated!');
}

main();
