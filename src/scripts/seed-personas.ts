/**
 * Seed Dr. Imani Carter persona with real Blotato account IDs and voice pool.
 * Run with: npx tsx src/scripts/seed-personas.ts
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

// All 18 raw ElevenLabs voice IDs
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

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    console.log('Seeding Dr. Imani Carter persona...');

    const { data, error } = await supabase.from('personas').insert({
        name: 'Dr. Imani Carter',
        brand: 'History Unveiled VA',
        tagline: 'Uncovering the untold stories of African American history in Virginia',
        expertise_areas: [
            'Freeman History in Virginia',
            'Civil Rights Movement in Virginia',
            'African American Genealogy',
            'Public History & Accessibility',
            'Colonial Period through Reconstruction',
            'Black entrepreneurship and land ownership',
            'Education and literacy movements',
            'Religious institutions and community building',
        ],
        voice_style: 'Authoritative yet accessible. PhD historian who makes complex history engaging for general audiences. Uses specific dates, names, and places. Corrects common misconceptions. Passionate but measured tone.',
        platform_accounts: {
            tiktok: '5294',
            instagram: '4346',
            youtube: '1290',
            threads: '1506',
            twitter: '1478',
        },
        voice_pool: VOICE_POOL,
    }).select().single();

    if (error) {
        console.error('Error seeding persona:', error.message);
        process.exit(1);
    }

    console.log(`Persona seeded successfully: ${data.id}`);
}

main();
