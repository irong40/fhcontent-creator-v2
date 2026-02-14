/**
 * Create operator auth user in Supabase.
 * Run with: npx tsx src/scripts/create-user.ts
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = 'admin@faithandharmony.com';
    const password = 'FH-Content-2025!';

    console.log(`Creating user: ${email}`);

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
    });

    if (error) {
        if (error.message.includes('already been registered')) {
            console.log('User already exists — skipping.');
            return;
        }
        console.error('Error:', error.message);
        process.exit(1);
    }

    console.log(`User created: ${data.user.id}`);
    console.log(`\nLogin credentials:`);
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
}

main();
