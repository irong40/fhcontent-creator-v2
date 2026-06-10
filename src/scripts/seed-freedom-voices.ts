/**
 * Seed the Freedom Voices persona — daily looping quote-card videos
 * (content_format='quote_video', migration 016).
 *
 * One quote per day from a documented Black freedom fighter, rendered as a
 * 1080x1920 card and shipped as a <5s looping video with an ACE-Step music
 * loop (see render_quote_videos.py on the music machine).
 *
 * Publishes to the Faith & Harmony video channels (same Blotato accounts the
 * H&G music pipeline posts to): TikTok 5294, Instagram 4346, YouTube 30796.
 * History content routes to F&H brands, never Sentinel Aerial.
 *
 * Run with: npx tsx src/scripts/seed-freedom-voices.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * NOTE: seeding alone activates nothing — the persona only enters the weekly
 * batch when its UUID is added to the AUTO_TOPIC_PERSONA_IDS Vercel env.
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    // Idempotent: skip if already seeded
    const { data: existing } = await supabase
        .from('personas')
        .select('id')
        .eq('name', 'Freedom Voices')
        .maybeSingle();
    if (existing) {
        console.log(`Freedom Voices already seeded: ${existing.id}`);
        return;
    }

    const { data: persona, error } = await supabase.from('personas').insert({
        name: 'Freedom Voices',
        brand: 'Freedom Voices',
        tagline: 'The words of those who fought to be free',
        content_format: 'quote_video',
        expertise_areas: [
            'Abolitionists: Frederick Douglass, Harriet Tubman, Sojourner Truth, David Walker, Henry Highland Garnet',
            'Anti-lynching and early civil rights: Ida B. Wells, W.E.B. Du Bois, Mary Church Terrell',
            'Civil Rights Movement: Martin Luther King Jr., Fannie Lou Hamer, Ella Baker, John Lewis, Bayard Rustin, Medgar Evers',
            'Black Power and self-determination: Malcolm X, Stokely Carmichael (Kwame Ture), Angela Davis, Fred Hampton',
            'Educators and institution builders: Booker T. Washington, Mary McLeod Bethune, Carter G. Woodson',
            'Writers and orators on freedom: James Baldwin, Audre Lorde, Maya Angelou, Langston Hughes',
            'Virginia freedom fighters: Gabriel Prosser, Nat Turner, Dred Scott era resisters, Barbara Johns',
        ],
        voice_style: 'Reverent and direct. The quote is the voice — captions provide historical context without editorializing. Specific dates, places, and sources. Dignity over drama.',
        content_guidelines: 'QUOTE AUTHENTICITY GUARDRAIL: Every quote must be real, verbatim, and documented — from a speech, letter, autobiography, interview, or published writing with a citable source and year. NEVER invent, paraphrase, modernize, or "improve" a quote. Misattributed viral quotes are an instant credibility kill — when authenticity is in doubt, pick a different quote. Quotes must be 35-60 words (loop-format requirement). Captions must name the source document and year.',
        platform_accounts: {
            tiktok: '5294',
            instagram: '4346',
            youtube: '30796',
        },
        voice_pool: [],
        is_active: true,
    }).select().single();

    if (error) {
        console.error('Error seeding Freedom Voices persona:', error.message);
        process.exit(1);
    }

    console.log(`Freedom Voices persona seeded: ${persona.id}`);
    console.log('To enable in the Sunday weekly batch, add this UUID to AUTO_TOPIC_PERSONA_IDS (Vercel env).');
}

main();
