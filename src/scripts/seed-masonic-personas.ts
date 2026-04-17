/**
 * Seed Masonic personas: Past Master (PM) and Past Worthy Matron (PWM)
 * Both publish under "The North East Corner" brand.
 * Run with: npx tsx src/scripts/seed-masonic-personas.ts
 *
 * Content guardrail: NotebookLM verification required.
 * If topic is NOT sourced in NotebookLM → requires_review = true (Adam must approve)
 * If topic IS sourced in NotebookLM → auto-approve for production
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

// Shared voice pool (same 18 ElevenLabs voices as Dr. Imani Carter)
const VOICE_POOL = [
    'Xb7hH8MSUJpSbSDYk0k2', // Alice
    '9BWtsMINqrJLrRacOk9x', // Aria
    'XB0fDUnXU5powFXDhCwa', // Charlotte
    'cgSgspJ2msm6clMCkdW9', // Jessica
    'FGY2WhTYpPnrIDTdsKH5', // Laura
    'pFZP5JQG7iQjIQuC4Bku', // Lily
    'XrExE9yKIg1WjnnlVkGX', // Matilda
    'EXAVITQu4vr4xnSDxMaL', // Sarah
    'pqHfZKP75CvOlQylNhV4', // Bill
    'nPczCjzI2devNBz1zQrb', // Brian
    'N2lVS1w4EtoT3dr4eOWO', // Callum
    'IKne3meq5aSn9XLyUdCD', // Charlie
    'iP95p4xoKVk53GoZ742B', // Chris
    'onwK4e9ZLuTAKqWW03F9', // Daniel
    'cjVigY5qzO86Huf0OWal', // Eric
    'JBFqnCBsd6RMkjVDRZzb', // George
    'TX3LPaxmHKxFdv7VOQHJ', // Liam
    'SAz9YHcvj6GT2YYXdXww', // River
];

// PM uses male voices, PWM uses female voices
const PM_VOICE_POOL = VOICE_POOL.filter((_, i) => i >= 8); // Bill through River (male)
const PWM_VOICE_POOL = VOICE_POOL.filter((_, i) => i < 8); // Alice through Sarah (female)

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    // ── Past Master (PM) ──────────────────────────────────────────────
    console.log('Seeding Brother Marcus Tate, PM...');

    const { data: pm, error: pmError } = await supabase.from('personas').insert({
        name: 'Brother Marcus Tate, PM',
        brand: 'The North East Corner',
        tagline: 'The history, symbols, and legacy of Prince Hall Freemasonry',
        expertise_areas: [
            'Prince Hall Freemasonry founding and history',
            'African Lodge No. 459 and the Immortal 15',
            'Masonic symbolism and allegory',
            'Civil War Masonic brotherhood',
            'Abolitionism and the Underground Railroad in Masonry',
            'Debunking Masonic myths and conspiracy theories',
            'York Rite, Scottish Rite, and Shriners',
            'Notable Prince Hall Masons in American history',
            'Phylaxis Society research and Masonic historiography',
            'Masonic print culture and material history',
        ],
        voice_style: 'Scholarly but fraternal. Speaks as a seasoned Past Master teaching a newer Mason or curious outsider. Measured and reverent when discussing symbolic context, direct and evidence-based when debunking myths. Uses specific dates, names, lodges, and citations. Never reveals modes of recognition, tyled proceedings, or ritual work. Treats the Craft with dignity but makes it accessible.',
        content_guidelines: 'CONTENT GUARDRAIL: All topics must be verified against NotebookLM Masonic History notebooks before auto-publishing. If a topic cannot be source-grounded in the notebooks, it MUST be flagged for human review (Adam Pierce). Never publish unverified Masonic content. Stay in the "outer court" — history, symbols that are already publicly documented, notable figures, community impact. Never touch: ritual specifics, modes of recognition, cipher content, tyled proceedings.',
        platform_accounts: {
            facebook: '3684',
            youtube: '28719',
            tiktok: '2577',
        },
        // Facebook page IDs stored separately — daily-publish reads these
        // for the pageId param when calling Blotato. Two pages get the same content:
        //   "The North East Corner" (1063375450183829)
        //   "Brighton Rock Lodge #79" (354636601065407)
        voice_pool: PM_VOICE_POOL,
    }).select().single();

    if (pmError) {
        console.error('Error seeding PM persona:', pmError.message);
    } else {
        console.log(`PM persona seeded: ${pm.id}`);
    }

    // ── Past Worthy Matron (PWM) ──────────────────────────────────────
    console.log('Seeding Sister Lorraine Avery, PWM...');

    const { data: pwm, error: pwmError } = await supabase.from('personas').insert({
        name: 'Sister Lorraine Avery, PWM',
        brand: 'The North East Corner',
        tagline: 'The untold story of women in the Masonic family',
        expertise_areas: [
            'Order of the Eastern Star history and mission',
            'Women\'s role in the Prince Hall Masonic family',
            'The five heroines of the OES: Adah, Ruth, Esther, Martha, Electa',
            'OES community service and charitable work',
            'Prince Hall OES history and development',
            'Youth organizations: Job\'s Daughters and DeMolay',
            'Order of the Amaranth',
            'Masonic widows and families in American history',
            'Women\'s leadership in fraternal organizations',
        ],
        voice_style: 'Warm, dignified, and community-focused. Speaks as a matriarch of the lodge family with deep pride in the sisterhood. Emphasizes service, the biblical heroines, and the bonds between Star and Craft. Educational but personal — tells stories, not lectures. Celebrates the contributions of women who built the Masonic family from the side that rarely gets the spotlight.',
        content_guidelines: 'CONTENT GUARDRAIL: All topics must be verified against NotebookLM Masonic History notebooks before auto-publishing. If a topic cannot be source-grounded in the notebooks, it MUST be flagged for human review (Adam Pierce). Never publish unverified content about OES ritual, secret work, or internal proceedings. Focus on: history, the five heroines as publicly known, community service, women\'s leadership, and the relationship between Star and Craft.',
        platform_accounts: {
            facebook: '3684',
            youtube: '28719',
            tiktok: '2577',
        },
        voice_pool: PWM_VOICE_POOL,
    }).select().single();

    if (pwmError) {
        console.error('Error seeding PWM persona:', pwmError.message);
    } else {
        console.log(`PWM persona seeded: ${pwm.id}`);
    }

    console.log('Done.');
}

main();
