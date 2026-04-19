/**
 * One-shot pipeline for Dr. Imani Carter's Jackson Ward topic.
 * Step 1: generate content pieces (scripts + captions) via Claude
 * Step 2: submit media jobs (ElevenLabs TTS + HeyGen video + Blotato shorts)
 * Step 3: approve + schedule for today so daily-publish picks it up
 */
import { createAdminClient } from '@/lib/supabase/server';
async function gpt4oGenerate(system: string, user: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 8192,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content as string;
}
import { elevenlabs } from '@/lib/elevenlabs';
import { heygen } from '@/lib/heygen';
import { blotato } from '@/lib/blotato';
import { contentResponseSchema } from '@/lib/schemas';
import { buildContentPrompt } from '@/lib/prompts';
import { estimateElevenLabsCost } from '@/lib/utils';
import { uploadAudio } from '@/lib/storage';
import type { PieceType, TopicWithPersona, ContentPiece } from '@/types/database';
import type { Database } from '@/types/database';

const TOPIC_ID = 'a7fe80ab-fd1a-4f6d-a62b-12daf4375bf9';

const PIECE_ORDER: Record<PieceType, number> = {
    long: 1, short_1: 2, short_2: 3, short_3: 4, short_4: 5, carousel: 6,
};

async function main() {
    const supabase = createAdminClient();

    // ── Step 1: Generate content pieces ──
    console.log('\n=== Step 1: Generating content pieces ===');

    const { data, error: topicError } = await supabase
        .from('topics')
        .select('*, personas(*)')
        .eq('id', TOPIC_ID)
        .single();

    if (topicError || !data) { console.error('Topic not found:', topicError?.message); process.exit(1); }

    const topic = data as unknown as TopicWithPersona;
    const persona = topic.personas;
    console.log(`Topic: ${topic.title}`);
    console.log(`Persona: ${persona.name}`);

    await supabase.from('topics').update({ status: 'content_generating' }).eq('id', TOPIC_ID);

    const { system, user } = buildContentPrompt(persona, topic);
    // Claude spend cap active until 2026-05-01 — use GPT-4o as fallback
    console.log('  Calling GPT-4o...');
    const text = await gpt4oGenerate(system, user);

    await supabase.from('cost_tracking').insert({
        service: 'openai',
        operation: 'content_generation',
        topic_id: TOPIC_ID,
        cost_usd: 0.02,
    });

    const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
    let rawParsed: unknown;
    try { rawParsed = JSON.parse(jsonText); } catch {
        await supabase.from('topics').update({ status: 'draft' }).eq('id', TOPIC_ID);
        console.error('Claude returned invalid JSON'); process.exit(1);
    }

    const contentResult = contentResponseSchema.safeParse(rawParsed);
    if (!contentResult.success) {
        await supabase.from('topics').update({ status: 'draft' }).eq('id', TOPIC_ID);
        console.error('Invalid content format:', contentResult.error.issues); process.exit(1);
    }

    for (const piece of contentResult.data.pieces) {
        const pieceType = piece.pieceType as PieceType;
        await supabase.from('content_pieces').insert({
            topic_id: TOPIC_ID,
            piece_type: pieceType,
            piece_order: PIECE_ORDER[pieceType] ?? 99,
            script: piece.script || null,
            caption_long: piece.captionLong || null,
            caption_short: piece.captionShort || null,
            thumbnail_prompt: piece.thumbnailPrompt || null,
            carousel_slides: piece.carouselSlides as unknown as Database['public']['Tables']['content_pieces']['Insert']['carousel_slides'] ?? null,
            music_track: piece.musicTrack || null,
            status: 'pending',
            content_channel: 'social',
        });
        console.log(`  Created piece: ${pieceType}`);
    }

    await supabase.from('topics').update({
        status: 'content_ready',
        content_ready_at: new Date().toISOString(),
    }).eq('id', TOPIC_ID);
    console.log('✓ Content ready');

    // ── Step 2: Submit media jobs ──
    console.log('\n=== Step 2: Submitting media jobs ===');

    const { data: allPieces } = await supabase
        .from('content_pieces')
        .select('*')
        .eq('topic_id', TOPIC_ID);

    if (!allPieces || allPieces.length === 0) { console.error('No pieces found after insert'); process.exit(1); }

    const avatarId = persona.heygen_avatar_id;

    // Long piece → ElevenLabs TTS + HeyGen video
    const longPiece = (allPieces as ContentPiece[]).find(p => p.piece_type === 'long');
    if (longPiece?.script) {
        if (avatarId) {
            console.log('  Generating TTS audio for long piece...');
            try {
                const audioBuffer = await elevenlabs.textToSpeech(topic.voice_id, longPiece.script);
                const audioUrl = await uploadAudio(`${TOPIC_ID}/long.mp3`, audioBuffer);

                await supabase.from('audio_assets').insert({
                    content_piece_id: longPiece.id,
                    voice_id: topic.voice_id,
                    audio_url: audioUrl,
                    status: 'ready',
                });
                await supabase.from('cost_tracking').insert({
                    service: 'elevenlabs', operation: 'tts_generation',
                    topic_id: TOPIC_ID, content_piece_id: longPiece.id,
                    cost_usd: estimateElevenLabsCost(longPiece.script.length),
                });

                console.log('  Submitting HeyGen video job...');
                const videoResponse = await heygen.createVideoFromAudio(avatarId, audioUrl);
                await supabase.from('content_pieces').update({
                    heygen_job_id: videoResponse.data.video_id,
                    heygen_status: 'processing',
                    status: 'processing',
                }).eq('id', longPiece.id);
                await supabase.from('cost_tracking').insert({
                    service: 'heygen', operation: 'video_generation',
                    topic_id: TOPIC_ID, content_piece_id: longPiece.id,
                    cost_usd: 0.25,
                });
                console.log(`  ✓ HeyGen job submitted: ${videoResponse.data.video_id}`);
            } catch (e: any) {
                console.error(`  ✗ Long piece media failed: ${e.message}`);
            }
        } else {
            console.log('  No HeyGen avatar — skipping long video');
        }
    }

    // Short pieces → Blotato faceless video
    const shortPieces = (allPieces as ContentPiece[]).filter(p =>
        ['short_1', 'short_2', 'short_3', 'short_4'].includes(p.piece_type) && p.script
    );
    const blotatoTemplateId = persona.blotato_template_id;

    for (const piece of shortPieces) {
        if (!blotatoTemplateId) { console.log(`  ✗ ${piece.piece_type}: no blotato_template_id`); continue; }
        try {
            const videoResponse = await blotato.createVideoFromPrompt(blotatoTemplateId, piece.script!);
            await supabase.from('content_pieces').update({
                blotato_job_id: videoResponse.item.id,
                blotato_status: 'processing',
                status: 'processing',
            }).eq('id', piece.id);
            await supabase.from('cost_tracking').insert({
                service: 'blotato', operation: 'faceless_video',
                topic_id: TOPIC_ID, content_piece_id: piece.id,
                cost_usd: 0.10,
            });
            console.log(`  ✓ Blotato job submitted for ${piece.piece_type}`);
        } catch (e: any) {
            console.error(`  ✗ ${piece.piece_type} Blotato failed: ${e.message}`);
        }
    }

    // ── Step 3: Approve + schedule for today ──
    console.log('\n=== Step 3: Approve + schedule for today ===');
    const today = new Date().toISOString().split('T')[0];

    const { error: schedErr } = await supabase.from('topics').update({
        status: 'scheduled',
        approved_at: new Date().toISOString(),
        publish_date: today,
        publish_time: '12:00',
    }).eq('id', TOPIC_ID);

    if (schedErr) { console.error('Schedule error:', schedErr.message); process.exit(1); }
    console.log(`✓ Scheduled for ${today}`);

    console.log('\n=== Pipeline complete ===');
    console.log('Media jobs rendering now (HeyGen ~15-30 min, Blotato ~5-10 min).');
    console.log('check-status cron (every 10 min) will mark pieces ready as they complete.');
    console.log('daily-publish cron (hourly) will publish once all pieces are ready.');
    console.log(`\nMonitor with: npx tsx --env-file=.env.local src/scripts/check-pieces.ts`);
}

main().catch(e => { console.error(e); process.exit(1); });
