/**
 * Generate OpenAI TTS audio for St. John's Day lecture.
 * Splits script into chunks (4096 char limit), generates each, concatenates.
 * Run with: npx tsx src/scripts/generate-stjohns-audio-openai.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const PIECE_ID = 'c6229931-2bee-4dfc-87fd-6e049dd50b59';
const TOPIC_ID = '132cfad9-504d-49b6-9f2f-8aa70fe526a3';
const MAX_CHARS = 4000; // leave buffer under 4096

function splitIntoParagraphChunks(text: string, maxChars: number): string[] {
    const paragraphs = text.split('\n\n');
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
        if (current.length + para.length + 2 > maxChars && current.length > 0) {
            chunks.push(current.trim());
            current = para;
        } else {
            current += (current ? '\n\n' : '') + para;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

async function generateChunk(text: string, apiKey: string): Promise<Buffer> {
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'tts-1-hd',
            input: text,
            voice: 'onyx',
            response_format: 'mp3',
            speed: 0.95,
        }),
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`OpenAI TTS error ${resp.status}: ${err}`);
    }

    return Buffer.from(await resp.arrayBuffer());
}

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: piece } = await supabase
        .from('content_pieces')
        .select('script')
        .eq('id', PIECE_ID)
        .single();

    if (!piece?.script) {
        console.error('No script found');
        process.exit(1);
    }

    const wordCount = piece.script.split(/\s+/).length;
    console.log(`Script: ${wordCount} words, ${piece.script.length} chars`);

    const chunks = splitIntoParagraphChunks(piece.script, MAX_CHARS);
    console.log(`Split into ${chunks.length} chunks:`);
    chunks.forEach((c, i) => console.log(`  Chunk ${i + 1}: ${c.length} chars`));

    console.log('\nGenerating audio with OpenAI TTS-1-HD (onyx voice)...');

    const audioBuffers: Buffer[] = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`  Generating chunk ${i + 1}/${chunks.length}...`);
        const buf = await generateChunk(chunks[i], process.env.OPENAI_API_KEY!);
        audioBuffers.push(buf);
        console.log(`  Chunk ${i + 1}: ${(buf.length / 1024).toFixed(0)} KB`);
    }

    // Concatenate MP3 buffers (MP3 is concatenatable)
    const combined = Buffer.concat(audioBuffers);
    const sizeMB = (combined.length / 1024 / 1024).toFixed(1);
    console.log(`\nCombined audio: ${sizeMB} MB`);

    // Save locally
    const outDir = path.join(process.cwd(), 'public', 'audio');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${TOPIC_ID}-stjohns.mp3`);
    fs.writeFileSync(outPath, combined);
    console.log('Saved to:', outPath);

    // Upload to Supabase storage
    const storagePath = `${TOPIC_ID}/long.mp3`;
    const { error: uploadErr } = await supabase.storage
        .from('media')
        .upload(storagePath, combined, {
            contentType: 'audio/mpeg',
            upsert: true,
        });

    if (uploadErr) {
        console.error('Supabase upload error:', uploadErr.message);
        console.log('Local file available at:', outPath);
    } else {
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(storagePath);
        console.log('Supabase URL:', urlData.publicUrl);

        const { error: assetErr } = await supabase.from('audio_assets').insert({
            content_piece_id: PIECE_ID,
            voice_id: 'openai-onyx',
            audio_url: urlData.publicUrl,
            status: 'ready',
        });

        if (assetErr) console.error('Asset record error:', assetErr.message);
        else console.log('Audio asset record created');
    }

    console.log(`\nEstimated duration: ~${(wordCount / 150 / 0.95).toFixed(1)} minutes`);
    console.log('Done!');
}

main();
