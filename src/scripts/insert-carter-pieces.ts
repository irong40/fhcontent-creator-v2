import { createAdminClient } from '@/lib/supabase/server';
import { buildContentPrompt } from '@/lib/prompts';
import { contentResponseSchema } from '@/lib/schemas';
import type { PieceType, TopicWithPersona } from '@/types/database';
import type { Database } from '@/types/database';

const TOPIC_ID = 'a7fe80ab-fd1a-4f6d-a62b-12daf4375bf9';

const PIECE_ORDER: Record<PieceType, number> = {
    long: 1, short_1: 2, short_2: 3, short_3: 4, short_4: 5, carousel: 6,
};

async function gpt4oGenerate(system: string, user: string): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 8192,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content as string;
}

async function main() {
    const supabase = createAdminClient();

    // Fetch topic
    const { data, error } = await supabase
        .from('topics')
        .select('*, personas(*)')
        .eq('id', TOPIC_ID)
        .single();

    if (error || !data) { console.error('Topic error:', error?.message); process.exit(1); }

    const topic = data as unknown as TopicWithPersona;
    console.log(`Topic: ${topic.title} | Status: ${topic.status}`);

    // Check existing pieces
    const { data: existing } = await supabase.from('content_pieces').select('id, piece_type').eq('topic_id', TOPIC_ID);
    console.log(`Existing pieces: ${existing?.length ?? 0}`);
    if (existing && existing.length > 0) {
        console.log('Pieces already exist — skipping generation');
        existing.forEach(p => console.log(`  ${p.piece_type}`));
        process.exit(0);
    }

    // Generate via GPT-4o
    console.log('\nGenerating content via GPT-4o...');
    await supabase.from('topics').update({ status: 'content_generating' }).eq('id', TOPIC_ID);

    const { system, user } = buildContentPrompt(topic.personas, topic);
    const text = await gpt4oGenerate(system, user);
    console.log('Got response, length:', text.length);

    const jsonText = text.replace(/```json\n?|\n?```/g, '').trim();
    let rawParsed: unknown;
    try {
        rawParsed = JSON.parse(jsonText);
    } catch (e) {
        console.error('JSON parse failed. Raw response:\n', text.slice(0, 500));
        await supabase.from('topics').update({ status: 'draft' }).eq('id', TOPIC_ID);
        process.exit(1);
    }

    const result = contentResponseSchema.safeParse(rawParsed);
    if (!result.success) {
        console.error('Schema validation failed:', result.error.issues);
        console.error('Parsed data:', JSON.stringify(rawParsed, null, 2).slice(0, 1000));
        await supabase.from('topics').update({ status: 'draft' }).eq('id', TOPIC_ID);
        process.exit(1);
    }

    console.log(`\nInserting ${result.data.pieces.length} pieces...`);
    for (const piece of result.data.pieces) {
        const pieceType = piece.pieceType as PieceType;
        const { data: inserted, error: insertErr } = await supabase
            .from('content_pieces')
            .insert({
                topic_id: TOPIC_ID,
                piece_type: pieceType,
                piece_order: PIECE_ORDER[pieceType] ?? 99,
                script: piece.script || null,
                caption_long: piece.captionLong || null,
                caption_short: piece.captionShort || null,
                thumbnail_prompt: piece.thumbnailPrompt || null,
                carousel_slides: (piece.carouselSlides ?? null) as unknown as Database['public']['Tables']['content_pieces']['Insert']['carousel_slides'],
                music_track: piece.musicTrack || null,
                status: 'pending',
            })
            .select('id, piece_type')
            .single();

        if (insertErr) {
            console.error(`  ✗ ${pieceType}: ${insertErr.message} | code: ${insertErr.code}`);
        } else {
            console.log(`  ✓ ${pieceType}: ${inserted?.id}`);
        }
    }

    await supabase.from('topics').update({
        status: 'content_ready',
        content_ready_at: new Date().toISOString(),
    }).eq('id', TOPIC_ID);

    console.log('\n✓ Done — topic is content_ready');
}

main().catch(e => { console.error(e); process.exit(1); });
