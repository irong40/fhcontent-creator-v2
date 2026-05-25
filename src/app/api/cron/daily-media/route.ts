import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { elevenlabs } from '@/lib/elevenlabs';
import { heygen } from '@/lib/heygen';
import { blotato } from '@/lib/blotato';
import { openai } from '@/lib/openai';
import { gemini } from '@/lib/gemini';
import { claude } from '@/lib/claude';
import { uploadAudio, uploadImage } from '@/lib/storage';
import { estimateElevenLabsCost, estimateDalleCost, base64ToArrayBuffer } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import { interpolateTemplate } from '@/lib/utils';
import type { HeyGenScene } from '@/lib/heygen';
import type { ContentPiece, TopicWithBrand, Brand, Persona, Topic, PieceType, CarouselSlide } from '@/types/database';

export const maxDuration = 800;

const HEYGEN_PIECE_TYPES: PieceType[] = ['long', 'lecture'];
const BLOTATO_PIECE_TYPES: PieceType[] = ['short_1', 'short_2', 'short_3', 'short_4'];

/**
 * Belt-and-suspenders directive prepended to every DALL-E call when the
 * persona has an image_subject_constraint. Catches legacy/scheduled prompts
 * authored before the prompts.ts framing-discipline rules landed.
 */
function applySubjectGuardrail(prompt: string, constraint: string | null | undefined): string {
    if (!constraint) return prompt;
    const directive =
        'HARD CONSTRAINT — read before rendering: ' + constraint + ' ' +
        'Render ZERO background figures, ZERO crowds, ZERO incidental people. ' +
        'If the prompt below describes people, render a TIGHT CLOSE-UP of ONE individual only, with dark brown skin clearly and unambiguously visible — never silhouette, never wide shot. ' +
        'If the prompt below mentions maps, "scenes", "community", or groups, omit all human figures entirely and render only objects, documents, architecture, or landscape. ' +
        'Prompt follows:\n\n';
    return directive + prompt;
}

/** Build HeyGen scene array: intro (optional) + main + outro (optional) */
function buildHeyGenScenes(
    avatarId: string,
    audioUrl: string,
    brand: Brand | null,
    persona: Persona,
    topic: Topic,
): HeyGenScene[] {
    const scenes: HeyGenScene[] = [];

    const templateVars: Record<string, string> = {
        brand_name: brand?.name || persona.brand,
        topic_title: topic.title,
        cta: persona.newsletter_cta || brand?.cta_template || '',
        persona_name: persona.name,
    };

    const makeBackground = (b: Brand | null): HeyGenScene['background'] => {
        if (b?.background_image_url) return { type: 'image', url: b.background_image_url };
        return { type: 'color', value: b?.brand_color || '#1a1a2e' };
    };

    const character: HeyGenScene['character'] = {
        type: 'avatar',
        avatar_id: avatarId,
        avatar_style: 'normal',
    };

    // Intro scene
    if (brand?.intro_text_template && persona.heygen_voice_id) {
        const introText = interpolateTemplate(brand.intro_text_template, templateVars);
        const introScene: HeyGenScene = {
            voice: { type: 'text', voice_id: persona.heygen_voice_id, input_text: introText },
            background: makeBackground(brand),
        };
        if (brand.intro_style !== 'background_only') {
            introScene.character = character;
        }
        introScene.elements = [{
            type: 'text',
            value: introText,
            style: { font_size: 40, font_color: '#ffffff' },
        }];
        scenes.push(introScene);
    }

    // Main scene (always present — lip-sync to ElevenLabs audio)
    scenes.push({
        character,
        voice: { type: 'audio', audio_url: audioUrl },
        background: makeBackground(brand),
    });

    // Outro scene
    if (brand?.outro_text_template && persona.heygen_voice_id) {
        const outroText = interpolateTemplate(brand.outro_text_template, templateVars);
        const outroScene: HeyGenScene = {
            voice: { type: 'text', voice_id: persona.heygen_voice_id, input_text: outroText },
            background: makeBackground(brand),
        };
        if (brand.outro_style !== 'background_only') {
            outroScene.character = character;
        }
        outroScene.elements = [{
            type: 'text',
            value: outroText,
            style: { font_size: 40, font_color: '#ffffff' },
        }];
        scenes.push(outroScene);
    }

    return scenes;
}

export async function GET(request: Request) {
    if (!validateCronSecret(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lockToken = await acquireLock('daily-media');
    if (!lockToken) {
        return NextResponse.json(
            { success: false, error: 'Workflow already running' },
            { status: 409 },
        );
    }

    try {
        const supabase = createAdminClient();

        // Find topics that need media: content_ready, or approved/scheduled with failed pieces.
        // Bound to today + 1 day so a Sunday batch (7 topics) doesn't try to
        // generate media for the whole upcoming week in one Vercel invocation
        // (maxDuration=800s, but ElevenLabs+HeyGen+DALL-E sequential calls
        // for 7×6 pieces will time out). Subsequent daily 06:00 UTC runs
        // catch the rest of the week.
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0];
        const { data: topics, error: topicError } = await supabase
            .from('topics')
            .select('*, personas(*)')
            .in('status', ['content_ready', 'approved', 'scheduled'])
            .lte('publish_date', tomorrow)
            .order('publish_date', { ascending: true, nullsFirst: false });

        if (topicError) {
            return NextResponse.json(
                { success: false, error: topicError.message },
                { status: 500 },
            );
        }

        if (!topics || topics.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No topics need media processing',
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
                const topic = topicRow as unknown as TopicWithBrand;
                const persona = topic.personas;
                const brand: Brand | null = persona.brands ?? null;
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
                    blotatoSubmitted: 0,
                    thumbnailsGenerated: 0,
                    carouselCreated: false,
                    musicGenerated: 0,
                    podcastGenerated: false,
                    errors: [] as string[],
                };

                // ── Stage 1a: Long-form video (HeyGen avatar path) ──
                const heygenPieces = (allPieces as ContentPiece[]).filter(
                    p => HEYGEN_PIECE_TYPES.includes(p.piece_type as PieceType),
                );

                for (const piece of heygenPieces) {
                    // Skip if HeyGen job is actively processing or already done
                    if (piece.heygen_job_id && piece.heygen_status === 'processing') continue;
                    if (piece.heygen_status === 'done') continue;
                    if (piece.heygen_status === 'failed' && (piece.retry_count ?? 0) >= 3) continue;

                    if (!piece.script) {
                        topicResult.errors.push(`${piece.piece_type}: no script`);
                        continue;
                    }

                    if (!avatarId) {
                        // Fallback: use Blotato AI Story Video for long-form when no HeyGen avatar
                        const templateId = persona.blotato_template_id;
                        if (templateId && !piece.blotato_job_id) {
                            try {
                                const videoResponse = await blotato.createVideoFromPrompt(
                                    templateId,
                                    piece.script,
                                );
                                await supabase
                                    .from('content_pieces')
                                    .update({
                                        blotato_job_id: videoResponse.item.id,
                                        blotato_status: 'processing',
                                        status: 'processing',
                                    })
                                    .eq('id', piece.id);
                                await supabase.from('cost_tracking').insert({
                                    service: 'blotato',
                                    operation: 'long_video_fallback',
                                    topic_id: topic.id,
                                    content_piece_id: piece.id,
                                    cost_usd: 0.15,
                                });
                                topicResult.blotatoSubmitted++;
                            } catch (e) {
                                topicResult.errors.push(
                                    `${piece.piece_type} Blotato fallback: ${e instanceof Error ? e.message : 'unknown'}`,
                                );
                            }
                        }
                        continue;
                    }

                    // Generate ElevenLabs TTS audio
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

                    // Build scenes and submit HeyGen video job
                    try {
                        const scenes = buildHeyGenScenes(avatarId, audioUrl, brand, persona, topic);
                        const isMultiScene = scenes.length > 1;

                        // Guard: log if brand has intro/outro but persona lacks heygen_voice_id
                        if (!persona.heygen_voice_id && (brand?.intro_text_template || brand?.outro_text_template)) {
                            console.warn(
                                `[daily-media] Persona "${persona.name}" has intro/outro templates but no heygen_voice_id — falling back to single scene`,
                            );
                        }

                        const videoResponse = isMultiScene
                            ? await heygen.createMultiSceneVideo({ scenes })
                            : await heygen.createVideoFromAudio(avatarId, audioUrl);

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
                            operation: isMultiScene ? 'video_generation_multi' : 'video_generation',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: isMultiScene ? 0.35 : 0.25,
                        });

                        topicResult.videoSubmitted++;
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} HeyGen: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                    }
                }

                // ── Stage 1b: Short-form video (Blotato faceless path) ──
                const blotatoPieces = (allPieces as ContentPiece[]).filter(
                    p => BLOTATO_PIECE_TYPES.includes(p.piece_type as PieceType),
                );

                for (const piece of blotatoPieces) {
                    // Skip if Blotato job is actively processing or already done
                    if (piece.blotato_job_id && piece.blotato_status === 'processing') continue;
                    if (piece.blotato_status === 'done') continue;
                    if (piece.blotato_status === 'failed' && (piece.retry_count ?? 0) >= 3) continue;

                    if (!piece.script) {
                        topicResult.errors.push(`${piece.piece_type}: no script`);
                        continue;
                    }

                    const templateId = persona.blotato_template_id;
                    if (!templateId) {
                        topicResult.errors.push(`${piece.piece_type}: no blotato_template_id on persona`);
                        continue;
                    }

                    try {
                        const videoResponse = await blotato.createVideoFromPrompt(
                            templateId,
                            piece.script,
                        );

                        await supabase
                            .from('content_pieces')
                            .update({
                                blotato_job_id: videoResponse.item.id,
                                blotato_status: 'processing',
                                status: 'processing',
                            })
                            .eq('id', piece.id);

                        await supabase.from('cost_tracking').insert({
                            service: 'blotato',
                            operation: 'faceless_video',
                            topic_id: topic.id,
                            content_piece_id: piece.id,
                            cost_usd: 0.10,
                        });

                        topicResult.blotatoSubmitted++;
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} Blotato: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                    }
                }

                // ── Stage 2: Thumbnails (all pieces with thumbnail_prompt) ──
                // Persona-scoped subject constraint: when set, every generated image is audited
                // against it before upload. Failed images are held (piece.status = failed) instead of publishing.
                const subjectConstraint = persona.image_subject_constraint;

                for (const piece of allPieces as ContentPiece[]) {
                    if (!piece.thumbnail_prompt || piece.thumbnail_url) continue;

                    try {
                        let imageBuffer: ArrayBuffer;
                        let sourceService = 'openai';

                        const guardedThumbnailPrompt = applySubjectGuardrail(piece.thumbnail_prompt, subjectConstraint);
                        let dalleErrMsg = '';
                        try {
                            const { url: dalleUrl } = await openai.generateImage(guardedThumbnailPrompt);
                            const imageResponse = await fetch(dalleUrl);
                            if (!imageResponse.ok) throw new Error(`download ${imageResponse.status}`);
                            imageBuffer = await imageResponse.arrayBuffer();
                        } catch (dalleErr) {
                            dalleErrMsg = dalleErr instanceof Error ? dalleErr.message : String(dalleErr);
                            console.warn(`[daily-media] DALL-E failed for ${piece.piece_type}: ${dalleErrMsg}`);
                            try {
                                const geminiResult = await gemini.generateImage(guardedThumbnailPrompt);
                                imageBuffer = base64ToArrayBuffer(geminiResult.imageData);
                                sourceService = 'gemini';
                            } catch (geminiErr) {
                                const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
                                throw new Error(`DALL-E: ${dalleErrMsg.slice(0, 200)} | Gemini: ${geminiMsg.slice(0, 200)}`);
                            }
                        }

                        // Subject-constraint audit (only when persona has one set)
                        if (subjectConstraint) {
                            const audit = await claude.auditImageSubjects(imageBuffer, subjectConstraint);
                            if (!audit.pass) {
                                await supabase.from('content_pieces').update({
                                    status: 'failed',
                                    error_message: `subject-audit failed (held for review): ${audit.reason ?? 'unspecified'}`,
                                }).eq('id', piece.id);
                                topicResult.errors.push(
                                    `${piece.piece_type} thumbnail held for review: ${audit.reason ?? 'audit failed'}`,
                                );
                                continue;
                            }
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

                // ── Stage 3: Carousel slides (DALL-E imagery, no external design tool) ──
                // Canva path removed 2026-05-02 — Adam canceled Canva subscription.
                // HUVA brand templates live in templates/huva/ (Playwright-rendered, $0).
                const carouselPiece = (allPieces as ContentPiece[]).find(p => p.piece_type === 'carousel');
                if (carouselPiece && !carouselPiece.carousel_url) {
                    const slides = carouselPiece.carousel_slides as CarouselSlide[] | null;
                    if (slides && slides.length > 0) {
                        try {
                            const imageUrls: string[] = [];
                            console.log(`[daily-media] Generating ${slides.length} carousel slides via DALL-E...`);
                            for (const slide of slides) {
                                if (slide.imagePrompt) {
                                    try {
                                        const guardedSlidePrompt = applySubjectGuardrail(slide.imagePrompt, subjectConstraint);
                                        const { url: dalleUrl } = await openai.generateImage(guardedSlidePrompt);
                                        const imageResponse = await fetch(dalleUrl);
                                        if (!imageResponse.ok) continue;
                                        const imageBuffer = await imageResponse.arrayBuffer();

                                        // Subject-constraint audit for carousel slides
                                        if (subjectConstraint) {
                                            const audit = await claude.auditImageSubjects(imageBuffer, subjectConstraint);
                                            if (!audit.pass) {
                                                topicResult.errors.push(
                                                    `carousel slide ${slide.slide} held: ${audit.reason ?? 'audit failed'}`,
                                                );
                                                continue;
                                            }
                                        }

                                        const storagePath = `${topic.id}/carousel_slide_${slide.slide}.png`;
                                        const slideUrl = await uploadImage(storagePath, imageBuffer, 'image/png');
                                        imageUrls.push(slideUrl);

                                        await supabase.from('visual_assets').insert({
                                            content_piece_id: carouselPiece.id,
                                            asset_type: 'carousel_image',
                                            source_service: 'openai',
                                            asset_url: slideUrl,
                                            metadata: { slide: slide.slide, prompt: slide.imagePrompt },
                                            status: 'ready',
                                        });

                                        console.log(`[daily-media] Slide ${slide.slide}: done`);
                                    } catch (e) {
                                        console.error(`[daily-media] Carousel slide ${slide.slide} DALL-E failed:`, e);
                                    }
                                }
                            }

                            if (imageUrls.length > 0) {
                                const carouselUrl = imageUrls.length === 1
                                    ? imageUrls[0]
                                    : JSON.stringify(imageUrls);
                                await supabase
                                    .from('content_pieces')
                                    .update({ carousel_url: carouselUrl })
                                    .eq('id', carouselPiece.id);

                                await supabase.from('cost_tracking').insert({
                                    service: 'openai',
                                    operation: 'dalle_carousel_slides',
                                    topic_id: topic.id,
                                    content_piece_id: carouselPiece.id,
                                    cost_usd: estimateDalleCost(imageUrls.length),
                                });

                                topicResult.carouselCreated = true;
                            } else if (slides.length > 0) {
                                // All slides failed (DALL-E error or audit rejection).
                                // Mark the carousel piece failed so daily-publish
                                // doesn't block on it forever and check-status can
                                // still resolve the topic from the other pieces.
                                await supabase.from('content_pieces').update({
                                    status: 'failed',
                                    error_message: `Carousel: 0/${slides.length} slides generated (DALL-E + audit rejection)`,
                                }).eq('id', carouselPiece.id);
                                topicResult.errors.push(
                                    `carousel: 0/${slides.length} slides — marked failed`,
                                );
                            }
                        } catch (e) {
                            topicResult.errors.push(
                                `carousel fallback: ${e instanceof Error ? e.message : 'unknown'}`,
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
                        const duration = piece.piece_type === 'long' ? 120 : 30;

                        // Try twice — Lyria is experimental and often fails
                        let musicResult = await gemini.generateMusic(mood, duration);
                        if (!musicResult) {
                            musicResult = await gemini.generateMusic(mood, duration);
                        }

                        if (musicResult) {
                            const storagePath = `${topic.id}/${piece.piece_type}_music.mp3`;
                            const musicUrl = await uploadAudio(storagePath, musicResult.audioData);

                            await supabase
                                .from('content_pieces')
                                .update({ music_track: musicUrl })
                                .eq('id', piece.id);

                            topicResult.musicGenerated++;
                        } else if (persona.default_music_url) {
                            // Lyria failed twice — fall back to the persona's pre-uploaded
                            // default music track so videos still ship with a music bed.
                            await supabase
                                .from('content_pieces')
                                .update({ music_track: persona.default_music_url })
                                .eq('id', piece.id);
                            topicResult.musicGenerated++;
                            console.warn(`[daily-media] Lyria failed for ${piece.piece_type} — used persona default_music_url`);
                        } else {
                            // No fallback configured. Surface as a warning so it's visible
                            // (was previously a silent console.warn only).
                            topicResult.errors.push(
                                `${piece.piece_type} music: Lyria unavailable (mood: ${mood}) and no default_music_url set on persona — video will ship without music bed`,
                            );
                        }
                    } catch (e) {
                        topicResult.errors.push(
                            `${piece.piece_type} music: ${e instanceof Error ? e.message : 'unknown'}`,
                        );
                    }
                }

                // ── Stage 5: Podcast (if long-form script exists and no episode yet) ──
                const longPiece = (allPieces as ContentPiece[]).find(
                    p => p.piece_type === 'long' && p.script,
                );

                if (longPiece && persona.brand_id) {
                    const { data: existingEpisode } = await supabase
                        .from('podcast_episodes')
                        .select('id')
                        .eq('topic_id', topic.id)
                        .limit(1);

                    if (!existingEpisode || existingEpisode.length === 0) {
                        try {
                            const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
                                || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
                            const podcastRes = await fetch(`${siteUrl}/api/media/podcast`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    topicId: topic.id,
                                    brandId: persona.brand_id,
                                }),
                            });

                            if (podcastRes.ok) {
                                topicResult.podcastGenerated = true;
                            } else {
                                const errBody = await podcastRes.json().catch(() => ({}));
                                topicResult.errors.push(
                                    `podcast: ${(errBody as { error?: string }).error || podcastRes.statusText}`,
                                );
                            }
                        } catch (e) {
                            topicResult.errors.push(
                                `podcast: ${e instanceof Error ? e.message : 'unknown'}`,
                            );
                        }
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
        }

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
    } finally {
        await releaseLock('daily-media', lockToken);
    }
}
