import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { openai } from '@/lib/openai';
import { gemini } from '@/lib/gemini';
import { uploadImage } from '@/lib/storage';
import { estimateDalleCost } from '@/lib/utils';
import { thumbnailGenerateSchema } from '@/lib/schemas';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId } = thumbnailGenerateSchema.parse(body);

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

        if (!piece.thumbnail_prompt) {
            return NextResponse.json(
                { success: false, error: 'Content piece has no thumbnail prompt' },
                { status: 400 },
            );
        }

        // Idempotent: skip if already generated
        if (piece.thumbnail_url) {
            return NextResponse.json({
                success: true,
                skipped: true,
                thumbnailUrl: piece.thumbnail_url,
            });
        }

        let imageBuffer: ArrayBuffer;
        let sourceService = 'openai';

        try {
            // Primary: DALL-E 3
            const { url: dalleUrl } = await openai.generateImage(piece.thumbnail_prompt);

            // Download DALL-E temporary URL
            const imageResponse = await fetch(dalleUrl);
            if (!imageResponse.ok) throw new Error('Failed to download DALL-E image');
            imageBuffer = await imageResponse.arrayBuffer();
        } catch (dalleError) {
            // Fallback: Gemini Imagen
            console.warn('DALL-E failed, trying Gemini fallback:', dalleError);
            const geminiResult = await gemini.generateImage(piece.thumbnail_prompt);
            if (!geminiResult) {
                throw new Error('Both DALL-E and Gemini image generation failed');
            }

            // Decode base64 image data
            const binaryStr = atob(geminiResult.imageData);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            imageBuffer = bytes.buffer;
            sourceService = 'gemini';
        }

        // Upload to Supabase Storage
        const storagePath = `${piece.topic_id}/${piece.piece_type}_thumbnail.png`;
        const thumbnailUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

        // Update content piece
        await supabase
            .from('content_pieces')
            .update({ thumbnail_url: thumbnailUrl })
            .eq('id', contentPieceId);

        // Insert visual asset record
        await supabase.from('visual_assets').insert({
            content_piece_id: contentPieceId,
            asset_type: 'thumbnail',
            source_service: sourceService,
            asset_url: thumbnailUrl,
            metadata: { prompt: piece.thumbnail_prompt },
            status: 'ready',
        });

        // Track cost (only for DALL-E)
        const costUsd = sourceService === 'openai' ? estimateDalleCost(1) : 0;
        if (costUsd > 0) {
            await supabase.from('cost_tracking').insert({
                service: 'openai',
                operation: 'dalle_thumbnail',
                topic_id: piece.topic_id,
                content_piece_id: contentPieceId,
                cost_usd: costUsd,
            });
        }

        return NextResponse.json({
            success: true,
            thumbnailUrl,
            sourceService,
            costUsd,
        });
    } catch (error) {
        console.error('Thumbnail generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
