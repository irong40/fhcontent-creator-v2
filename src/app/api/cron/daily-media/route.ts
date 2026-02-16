import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { elevenlabs } from '@/lib/elevenlabs';
import { heygen } from '@/lib/heygen';
import { openai } from '@/lib/openai';
import { gemini } from '@/lib/gemini';
import { canva, type AutofillData } from '@/lib/canva';
import { uploadAudio, uploadImage } from '@/lib/storage';
import { estimateElevenLabsCost, estimateDalleCost, base64ToArrayBuffer } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { validateCronSecret } from '../middleware';
import type { ContentPiece, TopicWithPersona, PieceType, CarouselSlide } from '@/types/database';

export const maxDuration = 300;

const VIDEO_PIECE_TYPES: PieceType[] = ['long', 'short_1', 'short_2', 'short_3', 'short_4'];

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();

        // Find topics that are content_ready but haven't had media generated
        const { data: topics, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .eq('status', 'content_ready');

        if (topicError) {
            return NextResponse.json(
                { success: false, error: topicError.message },
                { status: 500 },
            );
        }

        if (!topics || topics.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No content_ready topics to process',
                processed: 0,
            });
        }

        // Group topics by persona to stagger API calls across personas
        const topicsByPersona = new Map<string, typeof topics>();
        for (const topic of topics) {
            const personaId = topic.persona_id;
            if (!topicsByPersona.has(personaId)) topicsByPersona.set(personaId, []);
            topicsByPersona.get(personaId)!.push(topic);
        }

        const results = [];
        let isFirstPersona = true;

        for (const [, personaTopics] of topicsByPersona) {
            if (!isFirstPersona) {
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            isFirstPersona = false;

        for (const topicRow of personaTopics) {
            const topic = topicRow as unknown as TopicWithPersona;
            const persona = topic.personas;
            const avatarId = persona.heygen_avatar_id;

            // Fetch ALL pieces for this topic
            const { data: allPieces } = await supabase
                .from('content_pieces')
                .select('*')
                .eq('topic_id', topic.id);

            if (!allPieces || allPieces.length === 0) continue;

            const topicResult = {
                topicId: topic.id,
                title: topic.title,
                audioGenerated: 0,
                videoSubmitted: 0,
                thumbnailsGenerated: 0,
                carouselCreated: false,
                musicGenerated: 0,
                errors: [] as string[],
            };

            // ── Stage 1: Voice + Video (video pieces only) ──
            const videoPieces = allPieces.filter(p => VIDEO_PIECE_TYPES.includes(p.piece_type as PieceType));

            for (const piece of videoPieces as ContentPiece[]) {
                // Skip if HeyGen job already submitted
                if (piece.heygen_job_id) continue;

                if (!piece.script) {
                    topicResult.errors.push(`${piece.piece_type}: no script`);
                    continue;
                }

                // Check if audio already exists for this piece
                const { data: existingAudio } = await supabase
                    .from('audio_assets')
                    .select('id, audio_url')
                    .eq('content_piece_id', piece.id)
                    .eq('status', 'ready')
                    .limit(1);

                let audioUrl: string;

                if (existingAudio && existingAudio.length > 0) {
                    audioUrl = existingAudio[0].audio_url!;
                } else {
                    try {
                        const audioBuffer = await elevenlabs.textToSpeech(
                            topic.voice_id,
                            piece.script,
                        );

                        const storagePath = `${topic.id}/${piece.piece_type}.mp3`;
                        audioUrl = await uploadAudio(storagePath, audioBuffer);

                        await supabase.from('audio_assets').insert({
                            content_piece_id: piece.id,
                            voice_id: topic.voice_id,
                            audio_url: audioUrl,
                            status: 'ready',
                        });

                        await supabase.from('cost_tracking').insert({
                            service: 'elevenlabs',
                            operation: 'tts_generation',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: estimateElevenLabsCost(piece.script.length),
                        });

                        topicResult.audioGenerated++;
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} TTS: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                        continue;
                    }
                }

                // Submit HeyGen video job (only if avatar is configured)
                if (avatarId) {
                    try {
                        const videoResponse = await heygen.createVideoFromAudio(
                            avatarId,
                            audioUrl,
                        );

                        await supabase
                            .from('content_pieces')
                            .update({
                                heygen_job_id: videoResponse.data.video_id,
                                heygen_status: 'processing',
                                status: 'processing',
                            })
                            .eq('id', piece.id);

                        await supabase.from('cost_tracking').insert({
                            service: 'heygen',
                            operation: 'video_generation',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: 0.25,
                        });

                        topicResult.videoSubmitted++;
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} HeyGen: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                    }
                }
            }

            // ── Stage 2: Thumbnails (all pieces with thumbnail_prompt) ──
            for (const piece of allPieces as ContentPiece[]) {
                if (!piece.thumbnail_prompt || piece.thumbnail_url) continue;

                try {
                    let imageBuffer: ArrayBuffer;
                    let sourceService = 'openai';

                    try {
                        const { url: dalleUrl } = await openai.generateImage(piece.thumbnail_prompt);
                        const imageResponse = await fetch(dalleUrl);
                        if (!imageResponse.ok) throw new Error('Failed to download DALL-E image');
                        imageBuffer = await imageResponse.arrayBuffer();
                    } catch {
                        const geminiResult = await gemini.generateImage(piece.thumbnail_prompt);
                        if (!geminiResult) throw new Error('Both DALL-E and Gemini failed');

                        imageBuffer = base64ToArrayBuffer(geminiResult.imageData);
                        sourceService = 'gemini';
                    }

                    const storagePath = `${topic.id}/${piece.piece_type}_thumbnail.png`;
                    const thumbnailUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

                    await supabase
                        .from('content_pieces')
                        .update({ thumbnail_url: thumbnailUrl })
                        .eq('id', piece.id);

                    await supabase.from('visual_assets').insert({
                        content_piece_id: piece.id,
                        asset_type: 'thumbnail',
                        source_service: sourceService,
                        asset_url: thumbnailUrl,
                        metadata: { prompt: piece.thumbnail_prompt },
                        status: 'ready',
                    });

                    if (sourceService === 'openai') {
                        await supabase.from('cost_tracking').insert({
                            service: 'openai',
                            operation: 'dalle_thumbnail',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: estimateDalleCost(1),
                        });
                    }

                    topicResult.thumbnailsGenerated++;
                } catch (e) {
                    topicResult.errors.push(
                        `${piece.piece_type} thumbnail: ${e instanceof Error ? e.message : 'unknown'}`,
                    );
                }
            }

            // ── Stage 3: Carousel (carousel piece only) ──
            const carouselPiece = (allPieces as ContentPiece[]).find(p => p.piece_type === 'carousel');
            const carouselTemplateId = persona.canva_carousel_template_id;

            if (carouselPiece && carouselTemplateId && !carouselPiece.canva_design_id) {
                const slides = carouselPiece.carousel_slides as CarouselSlide[] | null;
                if (slides && slides.length > 0) {
                    try {
                        const autofillData: AutofillData = {};
                        let slideImagesGenerated = 0;

                        for (const slide of slides) {
                            autofillData[`slide_${slide.slide}_text`] = { type: 'text', text: slide.text };

                            if (slide.imagePrompt) {
                                try {
                                    const { url: dalleUrl } = await openai.generateImage(slide.imagePrompt);
                                    const imageResponse = await fetch(dalleUrl);
                                    if (!imageResponse.ok) continue;
                                    const imageBuffer = await imageResponse.arrayBuffer();

                                    const storagePath = `${topic.id}/carousel_slide_${slide.slide}.png`;
                                    const slideImageUrl = await uploadImage(storagePath, imageBuffer, 'image/png');

                                    const assetId = await canva.uploadAsset(
                                        `slide_${slide.slide}`,
                                        imageBuffer,
                                    );
                                    autofillData[`slide_${slide.slide}_image`] = { type: 'image', asset_id: assetId };
                                    slideImagesGenerated++;

                                    await supabase.from('visual_assets').insert({
                                        content_piece_id: carouselPiece.id,
                                        asset_type: 'carousel_image',
                                        source_service: 'openai',
                                        asset_url: slideImageUrl,
                                        metadata: { slide: slide.slide, prompt: slide.imagePrompt },
                                        status: 'ready',
                                    });
                                } catch (e) {
                                    console.warn(`Carousel slide ${slide.slide} image failed:`, e);
                                }
                            }
                        }

                        const designId = await canva.createDesignAutofill(carouselTemplateId, autofillData);

                        await supabase
                            .from('content_pieces')
                            .update({ canva_design_id: designId })
                            .eq('id', carouselPiece.id);

                        const exportedUrls = await canva.exportDesign(designId, 'png');

                        if (exportedUrls.length > 0) {
                            await supabase
                                .from('content_pieces')
                                .update({ carousel_url: exportedUrls[0] })
                                .eq('id', carouselPiece.id);
                        }

                        if (slideImagesGenerated > 0) {
                            await supabase.from('cost_tracking').insert({
                                service: 'openai',
                                operation: 'dalle_carousel_slides',
                                topic_id: topic.id,
                                content_piece_id: carouselPiece.id,
                                cost_usd: estimateDalleCost(slideImagesGenerated),
                            });
                        }

                        topicResult.carouselCreated = true;
                    } catch (e) {
                        topicResult.errors.push(
                            `carousel: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                    }
                }
            }

            // ── Stage 4: Music (all pieces with music_track mood) ──
            const piecesNeedingMusic = (allPieces as ContentPiece[]).filter(
                p => p.music_track && !p.music_track.startsWith('http'),
            );

            for (const piece of piecesNeedingMusic) {
                try {
                    const mood = piece.music_track || 'inspirational';
                    const duration = piece.piece_type === 'long' ? 120
                        : piece.piece_type.startsWith('short_') ? 30
                        : 30; // carousel

                    const musicResult = await gemini.generateMusic(mood, duration);

                    if (musicResult) {
                        const storagePath = `${topic.id}/${piece.piece_type}_music.mp3`;
                        const musicUrl = await uploadAudio(storagePath, musicResult.audioData);

                        await supabase
                            .from('content_pieces')
                            .update({ music_track: musicUrl })
                            .eq('id', piece.id);

                        topicResult.musicGenerated++;
                    }
                } catch (e) {
                    topicResult.errors.push(
                        `${piece.piece_type} music: ${e instanceof Error ? e.message : 'unknown'}`,
                    );
                }
            }

            if (topicResult.errors.length >= 3) {
                await notifyError({
                    source: 'daily-media',
                    message: `${topicResult.errors.length} errors: ${topicResult.errors.slice(0, 3).join('; ')}`,
                    topicId: topic.id,
                    personaName: persona.name,
                });
            }

            results.push(topicResult);
        }
        } // end persona group loop

        return NextResponse.json({
            success: true,
            processed: results.length,
            results,
        });
    } catch (error) {
        console.error('Daily media cron error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
