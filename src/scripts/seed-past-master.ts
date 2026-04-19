/**
 * Seed Past Master persona for Masonic educational content.
 * Publishes to NorthEast Corner YouTube + The North East Corner Facebook.
 * Run with: npx tsx src/scripts/seed-past-master.ts
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

// Male voices from ElevenLabs — scholarly, authoritative tone
const MALE_VOICE_POOL = [
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

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    console.log('Seeding Past Master persona...');

    const { data, error } = await supabase.from('personas').insert({
        name: 'The Past Master',
        brand: 'The North East Corner',
        tagline: 'Masonic education from the chair of King Solomon',
        expertise_areas: [
            'Masonic History & Traditions',
            'The Two Saints John',
            'Lodge Ritual & Ceremony',
            'Masonic Symbolism & Philosophy',
            'Grand Lodge History',
            'Masonic Jurisprudence',
            'Degree Work & Lectures',
            'Festive Boards & Observances',
        ],
        voice_style: 'Scholarly, warm, and reverent. A seasoned Past Master who speaks with the authority of one who has sat in the East, but with the humility and brotherly love that the Craft demands. Uses proper Masonic terminology naturally. Measured cadence — as if delivering a lecture in lodge. Never rushed. Treats the subject with the gravity it deserves while remaining accessible to newer Brethren.',
        content_guidelines: 'Content should be educational and suitable for public consumption — nothing that would violate Masonic obligations. Focus on history, philosophy, symbolism, and traditions that are already publicly documented. Always respectful of the Craft. No ritual secrets. Appropriate for both Masons and interested non-Masons.',
        platform_accounts: {
            youtube: '28719',       // NorthEast Corner YouTube
            facebook: '3684',       // Adam Pierce FB (The North East Corner page)
        },
        voice_pool: MALE_VOICE_POOL,
    }).select().single();

    if (error) {
        console.error('Error seeding persona:', error.message);
        process.exit(1);
    }

    console.log(`Past Master persona seeded: ${data.id}`);
}

main();
