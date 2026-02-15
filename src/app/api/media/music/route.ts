import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { gemini } from '@/lib/gemini';
import { uploadAudio } from '@/lib/storage';
import { musicGenerateSchema } from '@/lib/schemas';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, mood: overrideMood } = musicGenerateSchema.parse(body);

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

        // Determine mood: override > music_track field (Claude sets this as a mood string)
        const mood = overrideMood || piece.music_track || 'inspirational';

        // If music_track is already a URL, it's already been generated
        if (piece.music_track?.startsWith('http')) {
            return NextResponse.json({
                success: true,
                skipped: true,
                musicUrl: piece.music_track,
            });
        }

        // Attempt Gemini music generation
        const result = await gemini.generateMusic(mood, 30);

        if (!result) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: 'Music generation not available',
            });
        }

        // Upload to Supabase Storage
        const storagePath = `${piece.topic_id}/${piece.piece_type}_music.mp3`;
        const musicUrl = await uploadAudio(storagePath, result.audioData);

        // Update content piece: replace mood string with actual URL
        await supabase
            .from('content_pieces')
            .update({ music_track: musicUrl })
            .eq('id', contentPieceId);

        return NextResponse.json({
            success: true,
            musicUrl,
            mood,
        });
    } catch (error) {
        console.error('Music generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
