/**
 * Seed ElevenLabs voices into the voices table.
 * Run with: npx tsx src/scripts/seed-voices.ts
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

// Raw ElevenLabs voice IDs (extracted from Blotato-prefixed format in V1b)
const VOICES = [
    { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female', accent: 'British', style: 'news' },
    { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', gender: 'female', accent: 'American', style: 'social media' },
    { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'Swedish', style: 'characters' },
    { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', accent: 'American', style: 'conversational' },
    { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', accent: 'American', style: 'social media' },
    { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'British', style: 'narration' },
    { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'American', style: 'narration' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'American', style: 'news' },
    { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male', accent: 'American', style: 'narration' },
    { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', accent: 'American', style: 'narration' },
    { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'Transatlantic', style: 'characters' },
    { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', accent: 'Australian', style: 'conversational' },
    { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', accent: 'American', style: 'conversational' },
    { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'British', style: 'news' },
    { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'male', accent: 'American', style: 'conversational' },
    { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'British', style: 'narration' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'male', accent: 'American', style: 'narration' },
    { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'non-binary', accent: 'American', style: 'social media' },
];

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey);

    console.log(`Seeding ${VOICES.length} voices...`);

    const { error } = await supabase.from('voices').upsert(
        VOICES.map(v => ({
            id: v.id,
            name: v.name,
            gender: v.gender,
            accent: v.accent,
            style: v.style,
        })),
        { onConflict: 'id' }
    );

    if (error) {
        console.error('Error seeding voices:', error.message);
        process.exit(1);
    }

    console.log('Voices seeded successfully.');
}

main();
