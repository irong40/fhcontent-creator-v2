/**
 * Generate 6 Masonic-themed images for St. John's Day video using DALL-E 3.
 * Produces a cover + 5 chapter backgrounds in 16:9.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const TOPIC_ID = '132cfad9-504d-49b6-9f2f-8aa70fe526a3';

const IMAGES = [
    {
        name: 'cover.png',
        prompt: 'Cinematic wide shot of an ornate Masonic lodge room interior, warm candlelight, dark mahogany walls, black and white checkered floor, square and compass symbol prominently displayed, gold leaf accents, dramatic lighting, photorealistic, 16:9 aspect ratio, reverent atmosphere, no people, no text',
    },
    {
        name: 'ch1-origins.png',
        prompt: 'Medieval European stonemasons working on a gothic cathedral, weathered parchment overlay, ancient architectural drawings, warm golden hour lighting, compass and square tools visible, historical painting style, 16:9 cinematic, no text',
    },
    {
        name: 'ch2-two-saints.png',
        prompt: 'Symbolic illustration showing the summer and winter solstices, two circular sun symbols representing the two Saints John, point within a circle flanked by two parallel lines, warm amber and deep blue tones, Masonic allegorical art style, 16:9, no text',
    },
    {
        name: 'ch3-1717.png',
        prompt: 'Historic 18th century London tavern interior, the Goose and Gridiron Ale House, candlelit wooden tables with gathered men in period dress meeting, aged parchment and quill pens, warm firelight, historically accurate, cinematic, 16:9, no text, no modern elements',
    },
    {
        name: 'ch4-processions.png',
        prompt: 'Colonial American Masonic procession through historic city street, men in 18th century dress with Masonic aprons and regalia, banners and sashes, George Washington era, warm afternoon light, oil painting historical style, 16:9, no modern elements, no text',
    },
    {
        name: 'ch5-modern.png',
        prompt: 'Contemporary Masonic lodge room interior at sunset, warm golden light streaming through tall windows illuminating the altar with an open Volume of Sacred Law, square and compass resting on top, three candles burning, reverent and contemplative, photorealistic, 16:9, no people, no text',
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
            size: '1792x1024', // closest to 16:9
            quality: 'hd',
            response_format: 'b64_json',
        }),
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`DALL-E error ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    return Buffer.from(data.data[0].b64_json, 'base64');
}

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Save to sai-training-videos public dir so Remotion can load them via staticFile
    const outDir = path.join('D:', 'Projects', 'sai-training-videos', 'public', 'stjohns');
    fs.mkdirSync(outDir, { recursive: true });

    const urls: Record<string, string> = {};

    for (const img of IMAGES) {
        console.log(`Generating ${img.name}...`);
        const buffer = await generateImage(img.prompt, process.env.OPENAI_API_KEY!);
        const localPath = path.join(outDir, img.name);
        fs.writeFileSync(localPath, buffer);
        console.log(`  Saved: ${localPath} (${(buffer.length / 1024).toFixed(0)} KB)`);

        // Also upload to Supabase for remote access
        const storagePath = `${TOPIC_ID}/images/${img.name}`;
        const { error } = await supabase.storage
            .from('media')
            .upload(storagePath, buffer, {
                contentType: 'image/png',
                upsert: true,
            });

        if (!error) {
            const { data } = supabase.storage.from('media').getPublicUrl(storagePath);
            urls[img.name] = data.publicUrl;
            console.log(`  Uploaded: ${data.publicUrl}`);
        } else {
            console.error(`  Upload failed: ${error.message}`);
            urls[img.name] = `stjohns/${img.name}`; // fallback to staticFile path
        }
    }

    // Write URLs map for render script
    fs.writeFileSync(
        path.join('D:', 'Projects', 'fhcontent-creator-v2', 'src', 'scripts', 'stjohns-images.json'),
        JSON.stringify(urls, null, 2)
    );
    console.log('\nAll images generated and uploaded!');
    console.log('URLs saved to: src/scripts/stjohns-images.json');
}

main();
