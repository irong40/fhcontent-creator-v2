/**
 * Generate ElevenLabs audio for St. John's Day lecture.
 * Run with: npx tsx src/scripts/generate-stjohns-audio.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const PIECE_ID = 'c6229931-2bee-4dfc-87fd-6e049dd50b59';
const TOPIC_ID = '132cfad9-504d-49b6-9f2f-8aa70fe526a3';
const VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'; // Daniel — authoritative male

async function main() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch script
    const { data: piece } = await supabase
        .from('content_pieces')
        .select('script')
        .eq('id', PIECE_ID)
        .single();

    if (!piece?.script) {
        console.error('No script found for piece', PIECE_ID);
        process.exit(1);
    }

    console.log('Script:', piece.script.split(/\s+/).length, 'words,', piece.script.length, 'chars');
    console.log('Generating audio with ElevenLabs (Daniel voice)...');

    const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
            method: 'POST',
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY!,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: piece.script,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.6,
                    similarity_boost: 0.7,
                    style: 0.3,
                },
            }),
        }
    );

    if (!resp.ok) {
        const err = await resp.text();
        console.error('ElevenLabs error:', resp.status, err);
        process.exit(1);
    }

    const audioBuffer = Buffer.from(await resp.arrayBuffer());
    const sizeMB = (audioBuffer.length / 1024 / 1024).toFixed(1);
    console.log(`Audio generated: ${sizeMB} MB`);

    // Save locally
    const outDir = path.join(process.cwd(), 'public', 'audio');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${TOPIC_ID}-stjohns.mp3`);
    fs.writeFileSync(outPath, audioBuffer);
    console.log('Saved to:', outPath);

    // Also upload to Supabase storage
    const storagePath = `${TOPIC_ID}/long.mp3`;
    const { error: uploadErr } = await supabase.storage
        .from('media')
        .upload(storagePath, audioBuffer, {
            contentType: 'audio/mpeg',
            upsert: true,
        });

    if (uploadErr) {
        console.error('Supabase upload error:', uploadErr.message);
        console.log('Local file is available at:', outPath);
    } else {
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(storagePath);
        console.log('Supabase URL:', urlData.publicUrl);

        // Create audio_assets record
        const { error: assetErr } = await supabase.from('audio_assets').insert({
            content_piece_id: PIECE_ID,
            voice_id: VOICE_ID,
            audio_url: urlData.publicUrl,
            status: 'ready',
        });

        if (assetErr) {
            console.error('Asset record error:', assetErr.message);
        } else {
            console.log('Audio asset record created successfully');
        }
    }

    console.log('Done!');
}

main();
