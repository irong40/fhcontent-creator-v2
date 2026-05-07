/**
 * Render branded HUVA cards for a given topic and upload to Supabase storage.
 *
 * Usage (from project root):
 *   tsx scripts/render-topic-cards.ts <topicId>
 *
 * For each topic this generates:
 *   - hook-card.png       (1080x1920, intro card)
 *   - end-card.png        (1080x1920, sign-off card)
 *   - quote-slide.png     (1080x1920, only if persona has voice examples)
 *   - story-explainer-{1..N}.png  (1080x1920, one per historical_point)
 *   - carousel-{1..N}.png (1080x1080, one per carousel slide if present)
 *
 * Each is uploaded to Supabase storage at `branded-cards/{topicId}/<filename>`
 * and recorded in `visual_assets` with asset_type='huva_card'.
 *
 * Logo variant is read from topics.logo_variant (set automatically by trigger).
 *
 * Note: this is a LOCAL script — Playwright cannot run on Vercel serverless.
 * Run on Adam's rig before approving a topic for publish.
 */

import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFile, unlink, mkdir } from 'fs/promises';
import { renderHuvaTemplate, LogoVariant } from './render-huva';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') });

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = resolve(__dirname, '..', 'tmp', 'render-topic-cards');

interface HistoricalPoint { point: number; claim: string; source: string; year: string; }
interface CarouselSlide { slide: number; text: string; imagePrompt?: string; }

function buildClient(): SupabaseClient {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    }
    return createClient(url, key, { auth: { persistSession: false } });
}

async function uploadCard(
    supabase: SupabaseClient,
    bucket: string,
    objectPath: string,
    localPath: string,
    contentPieceId: string | null,
    metadata: Record<string, unknown>,
): Promise<string> {
    const buffer = await readFile(localPath);
    const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(objectPath, buffer, { contentType: 'image/png', upsert: true });
    if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const publicUrl = urlData.publicUrl;

    if (contentPieceId) {
        await supabase.from('visual_assets').insert({
            content_piece_id: contentPieceId,
            asset_type: 'huva_card',
            source_service: 'huva-renderer',
            asset_url: publicUrl,
            metadata,
            status: 'ready',
        });
    }

    return publicUrl;
}

async function main(topicId: string): Promise<void> {
    const supabase = buildClient();
    await mkdir(TMP_DIR, { recursive: true });

    const { data: topic, error: topicErr } = await supabase
        .from('topics')
        .select('*, personas(*)')
        .eq('id', topicId)
        .single();
    if (topicErr || !topic) throw new Error(`Topic ${topicId} not found: ${topicErr?.message}`);

    const persona = (topic as unknown as { personas: Record<string, unknown> }).personas;
    const variant = (topic.logo_variant ?? 1) as LogoVariant;
    const points = (topic.historical_points || []) as HistoricalPoint[];

    const personaSignoff = typeof persona.signature_signoff === 'string' ? persona.signature_signoff : null;

    console.log(`Topic: "${topic.title}" — logo variant ${variant}`);

    const { data: pieces } = await supabase
        .from('content_pieces')
        .select('*')
        .eq('topic_id', topicId);

    const longPiece = pieces?.find(p => p.piece_type === 'long') || null;
    const carouselPiece = pieces?.find(p => p.piece_type === 'carousel') || null;

    const bucket = 'media';

    // 1. Hook card
    {
        const out = resolve(TMP_DIR, 'hook-card.png');
        await renderHuvaTemplate('hook-card', variant, {
            title: topic.title,
            hook: topic.hook || '',
            location: 'Virginia',
        }, out);
        const url = await uploadCard(supabase, bucket, `branded-cards/${topicId}/hook-card.png`, out,
            longPiece?.id ?? null, { card: 'hook', logo_variant: variant });
        console.log(`  ✔ hook-card → ${url}`);
        await unlink(out).catch(() => {});
    }

    // 2. Story-explainer per historical point
    for (const pt of points) {
        const out = resolve(TMP_DIR, `story-${pt.point}.png`);
        await renderHuvaTemplate('story-explainer', variant, {
            eyebrow: `Point ${pt.point} of ${points.length}`,
            location: 'Virginia',
            year: pt.year || '',
            period: '',
            headline: pt.claim.slice(0, 120),
            body: pt.claim,
            source: pt.source || 'Library of Virginia',
        }, out);
        const url = await uploadCard(supabase, bucket, `branded-cards/${topicId}/story-${pt.point}.png`, out,
            longPiece?.id ?? null, { card: 'story-explainer', point: pt.point, logo_variant: variant });
        console.log(`  ✔ story-${pt.point} → ${url}`);
        await unlink(out).catch(() => {});
    }

    // 3. Quote slide (signature sign-off as ambient quote)
    if (personaSignoff) {
        const out = resolve(TMP_DIR, 'quote.png');
        await renderHuvaTemplate('quote-slide', variant, {
            quote: personaSignoff,
            attribution: 'Dr. Imani Carter',
            source: 'History Unveiled VA',
        }, out);
        const url = await uploadCard(supabase, bucket, `branded-cards/${topicId}/quote.png`, out,
            longPiece?.id ?? null, { card: 'quote', logo_variant: variant });
        console.log(`  ✔ quote-slide → ${url}`);
        await unlink(out).catch(() => {});
    }

    // 4. Carousel slides (one square card per text slide)
    if (carouselPiece) {
        const slides = (carouselPiece.carousel_slides || []) as CarouselSlide[];
        const total = slides.length;
        for (const s of slides) {
            const out = resolve(TMP_DIR, `carousel-${s.slide}.png`);
            await renderHuvaTemplate('carousel-slide', variant, {
                eyebrow: 'History Unveiled VA',
                slide_n: String(s.slide),
                slide_total: String(total),
                title: '',
                body: s.text,
            }, out);
            const url = await uploadCard(supabase, bucket, `branded-cards/${topicId}/carousel-${s.slide}.png`, out,
                carouselPiece.id, { card: 'carousel', slide: s.slide, logo_variant: variant });
            console.log(`  ✔ carousel-${s.slide} → ${url}`);
            await unlink(out).catch(() => {});
        }
    }

    // 5. End card
    {
        const out = resolve(TMP_DIR, 'end-card.png');
        await renderHuvaTemplate('end-card', variant, {}, out);
        const url = await uploadCard(supabase, bucket, `branded-cards/${topicId}/end-card.png`, out,
            longPiece?.id ?? null, { card: 'end', logo_variant: variant });
        console.log(`  ✔ end-card → ${url}`);
        await unlink(out).catch(() => {});
    }

    console.log(`\nDone. All cards live under bucket "${bucket}" / branded-cards/${topicId}/`);
}

const topicId = process.argv[2];
if (!topicId) {
    console.error('Usage: tsx scripts/render-topic-cards.ts <topicId>');
    process.exit(1);
}
main(topicId).catch(err => {
    console.error('Render failed:', err);
    process.exit(1);
});
