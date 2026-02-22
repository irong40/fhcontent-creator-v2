import { NextRequest, NextResponse } from 'next/server';
import { elevenlabs } from '@/lib/elevenlabs';
import { uploadAudio } from '@/lib/storage';
import { estimateElevenLabsCost } from '@/lib/utils';
import { voicePreviewSchema } from '@/lib/schemas';
import { createAdminClient } from '@/lib/supabase/server';

const MAX_PREVIEW_CHARS = 500;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { text, voiceId } = voicePreviewSchema.parse(body);

        const previewText = text.slice(0, MAX_PREVIEW_CHARS);
        const audioBuffer = await elevenlabs.textToSpeech(voiceId, previewText);

        // Upload to ephemeral preview path
        const filename = `previews/${Date.now()}-${voiceId.slice(0, 8)}.mp3`;
        const audioUrl = await uploadAudio(filename, audioBuffer);

        // Track cost separately from full TTS
        const supabase = createAdminClient();
        const costUsd = estimateElevenLabsCost(previewText.length);
        await supabase.from('cost_tracking').insert({
            service: 'elevenlabs',
            operation: 'tts_preview',
            cost_usd: costUsd,
        });

        return NextResponse.json({
            success: true,
            audioUrl,
            charCount: previewText.length,
            costUsd,
        });
    } catch (error) {
        console.error('Voice preview error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
