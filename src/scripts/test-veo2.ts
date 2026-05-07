/**
 * Test Veo 2 image-to-video with a single PHA photo (Prince Hall portrait).
 * If this works, we scale up to all 12 images.
 *
 * Veo 2 API reference:
 *   https://ai.google.dev/gemini-api/docs/video
 *   Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:generateVideo
 */

import * as fs from 'fs';
import * as path from 'path';

const TEST_IMAGE = 'D:/Projects/sai-training-videos/public/mwphglva/photos/Screenshot 2026-04-12 120554.png';
const OUT_PATH = 'D:/Projects/sai-training-videos/out/veo2-test-prince-hall.mp4';

async function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not set');
        process.exit(1);
    }

    console.log('Reading source image...');
    const imageBuffer = fs.readFileSync(TEST_IMAGE);
    const imageBase64 = imageBuffer.toString('base64');
    console.log(`Source: ${TEST_IMAGE} (${(imageBuffer.length / 1024).toFixed(0)} KB)`);

    // Prompt describes desired motion
    const prompt = "Subtle cinematic animation: the subject blinks naturally, makes very slight head movement, gentle breathing. Warm candlelight flickers slightly. No drastic motion, no camera movement, photorealistic, preserve the portrait's dignity and period accuracy.";

    const modelId = process.env.VEO_MODEL || 'veo-3.1-lite-generate-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:predictLongRunning?key=${apiKey}`;

    console.log(`\nSubmitting to Veo 2 (${modelId})...`);

    const body = {
        instances: [{
            prompt,
            image: {
                bytesBase64Encoded: imageBase64,
                mimeType: 'image/png',
            },
        }],
        parameters: {
            aspectRatio: '16:9',
            durationSeconds: 4,
            personGeneration: 'allow_adult',
        },
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.text();
        console.error('Veo 2 error:', resp.status, err);
        process.exit(1);
    }

    const initResult = await resp.json();
    console.log('Initial response:', JSON.stringify(initResult, null, 2).slice(0, 500));

    // Veo 2 is async — poll the operation
    const opName = initResult.name;
    if (!opName) {
        console.error('No operation name returned');
        process.exit(1);
    }

    console.log(`\nPolling operation: ${opName}`);
    let done = false;
    let attempts = 0;
    let result: any = null;

    while (!done && attempts < 30) {
        await new Promise(r => setTimeout(r, 10000));
        attempts++;
        const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${apiKey}`;
        const pollResp = await fetch(pollUrl);
        if (!pollResp.ok) {
            console.error(`Poll ${attempts}: ${pollResp.status}`);
            continue;
        }
        const pollData = await pollResp.json();
        console.log(`  Attempt ${attempts}: done=${pollData.done}`);
        if (pollData.done) {
            result = pollData;
            done = true;
        }
    }

    if (!done) {
        console.error('Timed out waiting for Veo 2');
        process.exit(1);
    }

    console.log('\nFinal result keys:', Object.keys(result));
    // Download the video
    const videoData = result.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
        || result.response?.videos?.[0]?.uri
        || result.response?.predictions?.[0]?.video?.bytesBase64Encoded;

    if (!videoData) {
        console.error('Could not find video in response');
        console.log(JSON.stringify(result, null, 2));
        process.exit(1);
    }

    if (videoData.startsWith('http')) {
        console.log(`\nDownloading from: ${videoData.substring(0, 80)}...`);
        const videoResp = await fetch(`${videoData}&key=${apiKey}`);
        const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
        fs.writeFileSync(OUT_PATH, videoBuffer);
        console.log(`Saved: ${OUT_PATH} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    } else {
        const videoBuffer = Buffer.from(videoData, 'base64');
        fs.writeFileSync(OUT_PATH, videoBuffer);
        console.log(`Saved: ${OUT_PATH} (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    }
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
