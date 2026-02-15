import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { elevenlabs } from '@/lib/elevenlabs';
import { uploadAudio } from '@/lib/storage';
import { estimateElevenLabsCost } from '@/lib/utils';
import { voiceGenerateSchema } from '@/lib/schemas';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, voiceId } = voiceGenerateSchema.parse(body);

        const supabase = createAdminClient();

        // Fetch content piece
        const { data: piece, error: fetchError } = await supabase
            .from('content_pieces')
            .select('*')
            .eq('id', contentPieceId)
            .single();

        if (fetchError || !piece) {
            return NextResponse.json(
                { success: false, error: 'Content piece not found' },
                { status: 404 },
            );
        }

        if (!piece.script) {
            return NextResponse.json(
                { success: false, error: 'Content piece has no script' },
                { status: 400 },
            );
        }

        // Generate TTS audio
        const audioBuffer = await elevenlabs.textToSpeech(voiceId, piece.script);

        // Upload to Supabase Storage
        const storagePath = `${piece.topic_id}/${piece.piece_type}.mp3`;
        const audioUrl = await uploadAudio(storagePath, audioBuffer);

        // Insert audio asset row
        const { data: audioAsset, error: insertError } = await supabase
            .from('audio_assets')
            .insert({
                content_piece_id: contentPieceId,
                voice_id: voiceId,
                audio_url: audioUrl,
                status: 'ready',
            })
            .select()
            .single();

        if (insertError) {
            return NextResponse.json(
                { success: false, error: `Failed to save audio asset: ${insertError.message}` },
                { status: 500 },
            );
        }

        // Track cost
        const costUsd = estimateElevenLabsCost(piece.script.length);

        await supabase.from('cost_tracking').insert({
            service: 'elevenlabs',
            operation: 'tts_generation',
            topic_id: piece.topic_id,
            content_piece_id: contentPieceId,
            cost_usd: costUsd,
        });

        return NextResponse.json({
            success: true,
            audioAssetId: audioAsset.id,
            audioUrl,
            charCount: piece.script.length,
            costUsd,
        });
    } catch (error) {
        console.error('Voice generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
