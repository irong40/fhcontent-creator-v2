import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { openai } from '@/lib/openai';
import { canva } from '@/lib/canva';
import { uploadImage } from '@/lib/storage';
import { estimateDalleCost } from '@/lib/utils';
import { carouselGenerateSchema } from '@/lib/schemas';
import type { CarouselSlide } from '@/types/database';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { contentPieceId, templateId, brandKitId } = carouselGenerateSchema.parse(body);

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

        if (piece.piece_type !== 'carousel') {
            return NextResponse.json(
                { success: false, error: 'Content piece is not a carousel type' },
                { status: 400 },
            );
        }

        const slides = piece.carousel_slides as CarouselSlide[] | null;
        if (!slides || slides.length === 0) {
            return NextResponse.json(
                { success: false, error: 'Content piece has no carousel slides' },
                { status: 400 },
            );
        }

        // Generate DALL-E images for each slide with an imagePrompt
        const autofillData: Record<string, string> = {};
        let imagesGenerated = 0;

        for (const slide of slides) {
            // Add slide text to autofill data
            autofillData[`slide_${slide.slide}_text`] = slide.text;

            if (slide.imagePrompt) {
                try {
                    const { url: dalleUrl } = await openai.generateImage(slide.imagePrompt);

                    // Download and upload to storage
                    const imageResponse = await fetch(dalleUrl);
                    if (!imageResponse.ok) throw new Error('Failed to download slide image');
                    const imageBuffer = await imageResponse.arrayBuffer();

                    const storagePath = `${piece.topic_id}/carousel_slide_${slide.slide}.png`;
                    const slideImageUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

                    autofillData[`slide_${slide.slide}_image`] = slideImageUrl;
                    imagesGenerated++;

                    // Insert visual asset for each slide image
                    await supabase.from('visual_assets').insert({
                        content_piece_id: contentPieceId,
                        asset_type: 'carousel_image',
                        source_service: 'openai',
                        asset_url: slideImageUrl,
                        metadata: { slide: slide.slide, prompt: slide.imagePrompt },
                        status: 'ready',
                    });
                } catch (e) {
                    console.warn(`Failed to generate image for slide ${slide.slide}:`, e);
                }
            }
        }

        // Create Canva design via autofill
        const { designId } = await canva.createDesignAutofill(templateId, autofillData);

        // Update content piece with design ID
        await supabase
            .from('content_pieces')
            .update({ canva_design_id: designId })
            .eq('id', contentPieceId);

        // Export design as PNG
        const exportJob = await canva.exportDesign(designId, 'png');
        const exportedUrls = await canva.pollExport(exportJob.id);

        // Update carousel_url with primary exported image
        if (exportedUrls.length > 0) {
            await supabase
                .from('content_pieces')
                .update({ carousel_url: exportedUrls[0] })
                .eq('id', contentPieceId);
        }

        // Track DALL-E costs for slide images
        if (imagesGenerated > 0) {
            const costUsd = estimateDalleCost(imagesGenerated);
            await supabase.from('cost_tracking').insert({
                service: 'openai',
                operation: 'dalle_carousel_slides',
                topic_id: piece.topic_id,
                content_piece_id: contentPieceId,
                cost_usd: costUsd,
            });
        }

        return NextResponse.json({
            success: true,
            designId,
            carouselUrl: exportedUrls[0] || null,
            exportedUrls,
            imagesGenerated,
            costUsd: estimateDalleCost(imagesGenerated),
        });
    } catch (error) {
        console.error('Carousel generation error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
