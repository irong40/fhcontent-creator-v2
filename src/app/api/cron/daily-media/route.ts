import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { blotato } from '@/lib/blotato';
import { openai } from '@/lib/openai';
import { gemini } from '@/lib/gemini';
import { claude } from '@/lib/claude';
import { uploadAudio, uploadImage } from '@/lib/storage';
import { estimateDalleCost, base64ToArrayBuffer } from '@/lib/utils';
import { notifyError } from '@/lib/notifications';
import { acquireLock, releaseLock } from '@/lib/workflow-lock';
import { validateCronSecret } from '../middleware';
import { generateSlideWithLadder, type SlideLadderDeps } from '@/lib/carousel-slide';
import { renderHuvaSlide } from '@/lib/huva-template';
import { renderQuoteCard } from '@/lib/quote-template';
import type { ContentPiece, TopicWithBrand, PieceType, CarouselSlide } from '@/types/database';

// resvg-js is a native addon and satori/font I/O reads from disk — must run on
// the Node.js serverless runtime, never edge.
export const runtime = 'nodejs';
export const maxDuration = 800;

// All faceless videos (long-form lectures + shorts) are produced through the
// Blotato AI Story Video path (createVideoFromPrompt). HeyGen avatar rendering
// was removed 2026-06-29 — no persona uses an avatar, so it was dead weight.
const VIDEO_PIECE_TYPES: PieceType[] = ['long', 'lecture', 'short_1', 'short_2', 'short_3', 'short_4'];

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
                    blotatoSubmitted: 0,
                    thumbnailsGenerated: 0,
                    carouselCreated: false,
                    musicGenerated: 0,
                    podcastGenerated: false,
                    errors: [] as string[],
                };

                // ── Stage 0: quote_video personas — render the quote card, then stop ──
                // The card PNG is stored on carousel_url; the local renderer on the
                // music machine (render_quote_videos.py) turns it into a <5s looping
                // mp4 with a bar-aligned ACE-Step music loop and writes video_url,
                // which daily-publish ships. No HeyGen/Blotato/thumbnail/Lyria spend
                // on this path — the card is satori-rendered ($0, zero human figures).
                if (persona.content_format === 'quote_video') {
                    const quotePiece = (allPieces as ContentPiece[]).find(
                        p => p.piece_type === 'quote_video',
                    );
                    if (quotePiece && !quotePiece.carousel_url) {
                        try {
                            const points = (topic.historical_points ?? []) as { claim: string; source: string; year: string }[];
                            const q = points[0];
                            if (!q?.claim) throw new Error('topic has no quote in historical_points[0]');

                            // Topic titles are "{Figure Name}: {essence}" — the figure is the attribution.
                            const attribution = topic.title.includes(':')
                                ? topic.title.split(':')[0].trim()
                                : q.source;

                            const png = await renderQuoteCard({
                                quote: q.claim,
                                attribution,
                                source: q.source,
                                year: q.year,
                                brandMark: persona.brand,
                            });
                            const cardUrl = await uploadImage(`${topic.id}/quote_card.png`, png, 'image/png');

                            await supabase
                                .from('content_pieces')
                                .update({ carousel_url: cardUrl, status: 'processing' })
                                .eq('id', quotePiece.id);

                            topicResult.carouselCreated = true;
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : 'unknown';
                            topicResult.errors.push(`quote_card: ${msg}`);
                            await notifyError({
                                source: 'daily-media',
                                message: `quote card render failed for "${topic.title}": ${msg}`,
                                topicId: topic.id,
                                personaName: persona.name,
                            });
                        }
                    }
                    results.push(topicResult);
                    continue;
                }

                // ── Stage 1: Faceless video (Blotato AI Story Video) ──
                // Long-form lectures and shorts both render through Blotato's
                // createVideoFromPrompt. The persona's blotato_template_id picks
                // the visual style; the piece script is the narration prompt.
                const videoPieces = (allPieces as ContentPiece[]).filter(
                    p => VIDEO_PIECE_TYPES.includes(p.piece_type as PieceType),
                );

                for (const piece of videoPieces) {
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

                // Photoreal-image ladder deps (shared by thumbnails below).
                // Imagen 4 primary → gpt-image-1 secondary → satori template fallback.
                // Every photographic rung is audited against the persona subject
                // constraint; the template fallback (no people) bypasses it legitimately.
                const imageLadderDeps: SlideLadderDeps = {
                    generatePrimary: async (prompt) => {
                        const result = await gemini.generateImage(prompt, { aspectRatio: '1:1' });
                        return base64ToArrayBuffer(result.imageData);
                    },
                    generateSecondary: async (prompt) => {
                        const result = await openai.generateImage(prompt);
                        return base64ToArrayBuffer(result.imageData);
                    },
                    audit: (image, constraint) => claude.auditImageSubjects(image, constraint),
                    renderTemplate: (slide) => renderHuvaSlide(slide, 1),
                    applyGuardrail: applySubjectGuardrail,
                    log: (m) => console.log(m),
                };

                for (const piece of allPieces as ContentPiece[]) {
                    if (!piece.thumbnail_prompt || piece.thumbnail_url) continue;

                    try {
                        // Run the photoreal ladder. A thumbnail can never hard-fail:
                        // if both generative rungs fail the audit / throw, the satori
                        // template (a HUVA text card) is the guaranteed last resort.
                        const result = await generateSlideWithLadder(
                            { slide: 0, text: piece.thumbnail_prompt, imagePrompt: piece.thumbnail_prompt },
                            subjectConstraint,
                            imageLadderDeps,
                        );
                        const imageBuffer = result.imageBuffer;
                        const sourceService = result.source === 'imagen' ? 'gemini' : result.source;

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
                            metadata: {
                                prompt: piece.thumbnail_prompt,
                                attempts: result.attempts.map(a => ({
                                    provider: a.provider,
                                    attempt: a.attempt,
                                    outcome: a.outcome,
                                    ...(a.detail ? { detail: a.detail } : {}),
                                })),
                            },
                            status: 'ready',
                        });

                        if (result.source === 'openai') {
                            await supabase.from('cost_tracking').insert({
                                service: 'openai',
                                operation: 'gpt_image_thumbnail',
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

                // ── Stage 3: Carousel slides (TEMPLATE-FIRST, satori-rendered) ──
                // Canva path removed 2026-05-02 — Adam canceled Canva subscription.
                // HUVA carousel slides are text-over-background with NO people, so they
                // are rendered deterministically with satori (+ resvg) on the node
                // serverless runtime: $0, never fails, no subject audit needed. This is
                // the PRIMARY and only path for carousel slides — no generative models.
                const carouselPiece = (allPieces as ContentPiece[]).find(p => p.piece_type === 'carousel');
                if (carouselPiece && !carouselPiece.carousel_url) {
                    const slides = carouselPiece.carousel_slides as CarouselSlide[] | null;
                    if (slides && slides.length > 0) {
                        try {
                            const imageUrls: string[] = [];
                            const renderable = slides.filter(s => s.imagePrompt || s.text);
                            const slideTotal = renderable.length;
                            console.log(`[daily-media] Rendering ${slideTotal} carousel slides via satori template...`);

                            for (const slide of renderable) {
                                try {
                                    const imageBuffer = await renderHuvaSlide(slide, slideTotal);

                                    const storagePath = `${topic.id}/carousel_slide_${slide.slide}.png`;
                                    const slideUrl = await uploadImage(storagePath, imageBuffer, 'image/png');
                                    imageUrls.push(slideUrl);

                                    await supabase.from('visual_assets').insert({
                                        content_piece_id: carouselPiece.id,
                                        asset_type: 'carousel_image',
                                        source_service: 'template',
                                        asset_url: slideUrl,
                                        metadata: {
                                            slide: slide.slide,
                                            prompt: slide.imagePrompt,
                                            attempts: [{ provider: 'template', attempt: 1, outcome: 'used' }],
                                        },
                                        status: 'ready',
                                    });

                                    console.log(`[daily-media] Slide ${slide.slide}: done via template`);
                                } catch (e) {
                                    // Only reachable if the satori renderer itself throws.
                                    console.error(`[daily-media] Carousel slide ${slide.slide} failed entirely:`, e);
                                    topicResult.errors.push(
                                        `carousel slide ${slide.slide}: ${e instanceof Error ? e.message : 'unknown'}`,
                                    );
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

                                topicResult.carouselCreated = true;
                            } else if (slides.length > 0) {
                                // All slides failed (DALL-E error or audit rejection).
                                // Mark the carousel piece failed so daily-publish
                                // doesn't block on it forever and check-status can
                                // still resolve the topic from the other pieces.
                                await supabase.from('content_pieces').update({
                                    status: 'failed',
                                    error_message: `Carousel: 0/${slides.length} slides rendered (satori template renderer failed)`,
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
