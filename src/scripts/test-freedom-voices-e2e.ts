/**
 * Freedom Voices E2E dry run — exercises the full quote_video path EXCEPT
 * publishing:
 *   topic gen (Claude) → topic insert → caption gen (Claude) → piece insert
 *   → quote card render (satori) → storage upload → carousel_url set.
 *
 * The topic is inserted with publish_date=null/publish_at=null so the
 * daily-media, content-generator, and daily-publish crons all skip it.
 * After this, run render_quote_videos.py on the music machine to produce
 * the looping mp4 (it queries by piece fields, not publish_date), then
 * review the video_url before enabling the persona.
 *
 * Run with: npx tsx --env-file=.env.local src/scripts/test-freedom-voices-e2e.ts
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { claude } from '../lib/claude';
import { buildTopicPrompt, buildContentPrompt } from '../lib/prompts';
import { topicResponseSchema, quoteContentResponseSchema, countWords } from '../lib/schemas';
import { renderQuoteCard } from '../lib/quote-template';
import { uploadImage } from '../lib/storage';
import type { Database, Persona, Topic } from '../types/database';

async function main() {
    const supabase = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // 1. Load persona
    const { data: persona, error: pErr } = await supabase
        .from('personas')
        .select('*')
        .eq('name', 'Freedom Voices')
        .single();
    if (pErr || !persona) throw new Error(`persona not found: ${pErr?.message}`);
    console.log(`Persona: ${persona.id} (content_format=${persona.content_format})`);

    // 2. Generate one quote topic
    const { system, user } = buildTopicPrompt(persona as Persona, [], 1);
    const topicGen = await claude.generateContent(system, user, { maxTokens: 4096 });
    const topicJson = JSON.parse(topicGen.text.replace(/```json\n?|\n?```/g, '').trim());
    const topicParsed = topicResponseSchema.parse(topicJson);
    const t = topicParsed.topics[0];
    const quoteWords = countWords(t.historicalPoints[0].claim);
    console.log(`Topic: "${t.title}" — quote is ${quoteWords} words`);
    if (quoteWords < 30) throw new Error('quote too short for the loop format');

    // 3. Insert topic — content_ready + null publish dates keeps every cron away
    const { data: topic, error: tErr } = await supabase
        .from('topics')
        .insert({
            persona_id: persona.id,
            title: t.title,
            hook: t.hook,
            historical_points: t.historicalPoints as unknown as Database['public']['Tables']['topics']['Insert']['historical_points'],
            topic_hash: crypto.createHash('md5').update(t.title.toLowerCase().trim()).digest('hex'),
            voice_id: 'default',
            status: 'content_ready',
            publish_date: null,
            publish_at: null,
        })
        .select()
        .single();
    if (tErr || !topic) throw new Error(`topic insert failed: ${tErr?.message}`);
    console.log(`Topic inserted: ${topic.id}`);

    // 4. Generate captions (single quote_video piece)
    const contentPrompt = buildContentPrompt(persona as Persona, topic as unknown as Topic);
    const contentGen = await claude.generateContent(contentPrompt.system, contentPrompt.user, { maxTokens: 4096 });
    const contentJson = JSON.parse(contentGen.text.replace(/```json\n?|\n?```/g, '').trim());
    const piece = quoteContentResponseSchema.parse(contentJson).pieces[0];

    const { data: insertedPiece, error: cErr } = await supabase
        .from('content_pieces')
        .insert({
            topic_id: topic.id,
            piece_type: 'quote_video',
            piece_order: 1,
            script: piece.script,
            caption_long: piece.captionLong,
            caption_short: piece.captionShort,
            status: 'ready',
        })
        .select()
        .single();
    if (cErr || !insertedPiece) throw new Error(`piece insert failed: ${cErr?.message}`);
    console.log(`Piece inserted: ${insertedPiece.id}`);

    // 5. Render + upload the quote card (mirrors the daily-media Stage 0)
    const q = t.historicalPoints[0];
    const attribution = t.title.includes(':') ? t.title.split(':')[0].trim() : q.source;
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
        .eq('id', insertedPiece.id);

    console.log('--- DRY RUN READY ---');
    console.log(`Card:    ${cardUrl}`);
    console.log(`Caption: ${piece.captionLong.slice(0, 160)}…`);
    console.log('Next: run render_quote_videos.py to produce the looping mp4.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
