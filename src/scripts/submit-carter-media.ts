import { createAdminClient } from '@/lib/supabase/server';
import { elevenlabs } from '@/lib/elevenlabs';
import { heygen } from '@/lib/heygen';
import { blotato } from '@/lib/blotato';
import { uploadAudio } from '@/lib/storage';
import { estimateElevenLabsCost } from '@/lib/utils';
import type { ContentPiece, TopicWithPersona } from '@/types/database';

const TOPIC_ID = 'a7fe80ab-fd1a-4f6d-a62b-12daf4375bf9';

async function main() {
    const supabase = createAdminClient();

    const { data, error } = await supabase
        .from('topics')
        .select('*, personas(*)')
        .eq('id', TOPIC_ID)
        .single();

    if (error || !data) { console.error('Topic error:', error?.message); process.exit(1); }

    const topic = data as unknown as TopicWithPersona;
    const persona = topic.personas;
    const avatarId = persona.heygen_avatar_id;
    const blotatoTemplateId = persona.blotato_template_id;

    console.log(`Persona: ${persona.name}`);
    console.log(`HeyGen avatar: ${avatarId ?? 'none'}`);
    console.log(`Blotato template: ${blotatoTemplateId ?? 'none'}`);

    const { data: pieces } = await supabase
        .from('content_pieces')
        .select('*')
        .eq('topic_id', TOPIC_ID)
        .order('piece_order');

    if (!pieces || pieces.length === 0) { console.error('No pieces found'); process.exit(1); }
    console.log(`\nFound ${pieces.length} pieces\n`);

    // ── Long piece: ElevenLabs TTS + HeyGen ──
    const longPiece = (pieces as ContentPiece[]).find(p => p.piece_type === 'long');
    if (longPiece?.script && avatarId) {
        console.log('=== Long piece: TTS + HeyGen ===');
        try {
            const audioBuffer = await elevenlabs.textToSpeech(topic.voice_id, longPiece.script);
            const audioUrl = await uploadAudio(`${TOPIC_ID}/long.mp3`, audioBuffer);
            console.log('  ✓ TTS audio uploaded:', audioUrl.slice(0, 60) + '...');

            await supabase.from('audio_assets').insert({
                content_piece_id: longPiece.id,
                voice_id: topic.voice_id,
                audio_url: audioUrl,
                status: 'ready',
            });

            const videoResponse = await heygen.createVideoFromAudio(avatarId, audioUrl);
            const jobId = videoResponse.data.video_id;
            await supabase.from('content_pieces').update({
                heygen_job_id: jobId,
                heygen_status: 'processing',
                status: 'processing',
            }).eq('id', longPiece.id);

            await supabase.from('cost_tracking').insert([
                { service: 'elevenlabs', operation: 'tts_generation', topic_id: TOPIC_ID, content_piece_id: longPiece.id, cost_usd: estimateElevenLabsCost(longPiece.script.length) },
                { service: 'heygen', operation: 'video_generation', topic_id: TOPIC_ID, content_piece_id: longPiece.id, cost_usd: 0.25 },
            ]);
            console.log(`  ✓ HeyGen job submitted: ${jobId}`);
        } catch (e: any) {
            console.error(`  ✗ Long piece failed: ${e.message}`);
        }
    } else if (longPiece && !avatarId) {
        console.log('=== Long piece: no avatar configured, skipping HeyGen ===');
    }

    // ── Short pieces: Blotato ──
    const shortPieces = (pieces as ContentPiece[]).filter(p =>
        ['short_1', 'short_2', 'short_3', 'short_4'].includes(p.piece_type) && p.script
    );

    console.log(`\n=== Short pieces (${shortPieces.length}) → Blotato ===`);
    if (!blotatoTemplateId) {
        console.log('  No blotato_template_id on persona — skipping shorts');
    } else {
        for (const piece of shortPieces) {
            try {
                const videoResponse = await blotato.createVideoFromPrompt(blotatoTemplateId, piece.script!);
                await supabase.from('content_pieces').update({
                    blotato_job_id: videoResponse.item.id,
                    blotato_status: 'processing',
                    status: 'processing',
                }).eq('id', piece.id);
                await supabase.from('cost_tracking').insert({
                    service: 'blotato', operation: 'faceless_video',
                    topic_id: TOPIC_ID, content_piece_id: piece.id, cost_usd: 0.10,
                });
                console.log(`  ✓ ${piece.piece_type}: job ${videoResponse.item.id}`);
            } catch (e: any) {
                console.error(`  ✗ ${piece.piece_type}: ${e.message}`);
            }
        }
    }

    // ── Approve + schedule for today ──
    console.log('\n=== Approve + schedule for today ===');
    const today = new Date().toISOString().split('T')[0];
    const { error: schedErr } = await supabase.from('topics').update({
        status: 'scheduled',
        approved_at: new Date().toISOString(),
        publish_date: today,
        publish_time: '12:00',
    }).eq('id', TOPIC_ID);

    if (schedErr) { console.error('Schedule error:', schedErr.message); process.exit(1); }
    console.log(`✓ Scheduled for ${today}`);
    console.log('\nMedia jobs submitted. check-status cron polls every 10 min.');
    console.log('daily-publish (hourly) publishes once pieces are ready.');
}

main().catch(e => { console.error(e); process.exit(1); });
