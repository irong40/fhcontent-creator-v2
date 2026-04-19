/**
 * Regenerate St. John's lecture audio with a more natural voice.
 * Switches from 'onyx' (robotic) to 'echo' (warm natural male) at 1.0x speed.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const PIECE_ID = 'c6229931-2bee-4dfc-87fd-6e049dd50b59';
const TOPIC_ID = '132cfad9-504d-49b6-9f2f-8aa70fe526a3';
const MAX_CHARS = 4000;
const VOICE = process.env.TTS_VOICE || 'echo'; // override via env
const SPEED = parseFloat(process.env.TTS_SPEED || '1.0');

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
            voice: VOICE,
            response_format: 'mp3',
            speed: SPEED,
        }),
    });

    if (!resp.ok) {
        throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
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
        console.error('No script');
        process.exit(1);
    }

    const chunks = splitIntoParagraphChunks(piece.script, MAX_CHARS);
    console.log(`Voice: ${VOICE} at ${SPEED}x speed`);
    console.log(`Generating ${chunks.length} chunks...`);

    const buffers: Buffer[] = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`  Chunk ${i + 1}/${chunks.length}: ${chunks[i].length} chars`);
        buffers.push(await generateChunk(chunks[i], process.env.OPENAI_API_KEY!));
    }

    const combined = Buffer.concat(buffers);
    console.log(`Combined: ${(combined.length / 1024 / 1024).toFixed(1)} MB`);

    const outDir = path.join(process.cwd(), 'public', 'audio');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${TOPIC_ID}-stjohns-${VOICE}.mp3`);
    fs.writeFileSync(outPath, combined);
    console.log(`Local: ${outPath}`);

    const storagePath = `${TOPIC_ID}/long.mp3`;
    const { error } = await supabase.storage
        .from('media')
        .upload(storagePath, combined, {
            contentType: 'audio/mpeg',
            upsert: true,
        });

    if (error) console.error('Upload error:', error.message);
    else {
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(storagePath);
        console.log(`Remote: ${urlData.publicUrl}`);
    }

    const wordCount = piece.script.split(/\s+/).length;
    console.log(`Est. duration at ${SPEED}x: ~${(wordCount / 150 / SPEED).toFixed(1)} min`);
}

main();
