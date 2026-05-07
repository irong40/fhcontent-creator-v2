import { createClient } from '@supabase/supabase-js';

async function main() {
    const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create brand
    const { data: brand, error: brandErr } = await sb.from('brands').insert({
        name: 'History Unveiled VA',
        vertical: 'African American History in Virginia',
        platform_accounts: { tiktok: '5294', instagram: '4346', youtube: '1290', threads: '1506', twitter: '1478' },
        is_active: true,
    }).select().single();

    if (brandErr) { console.error('Brand error:', brandErr.message); process.exit(1); }
    console.log('Brand created:', brand.id, brand.name);

    // Link persona to brand
    const { error: linkErr } = await sb.from('personas').update({ brand_id: brand.id })
        .eq('id', '4db2baf3-ae13-4a84-ae2b-edfe3ce6499b');

    if (linkErr) { console.error('Link error:', linkErr.message); process.exit(1); }
    console.log('Persona linked to brand');

    // Verify
    const { data: persona } = await sb.from('personas')
        .select('id,name,brand,brand_id')
        .eq('id', '4db2baf3-ae13-4a84-ae2b-edfe3ce6499b')
        .single();
    console.log('Persona:', JSON.stringify(persona));
}

main();
