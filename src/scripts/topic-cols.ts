import { createClient } from '@supabase/supabase-js';
async function main() {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb.from('topics').select('*').limit(1);
    if (data && data[0]) console.log('Topic columns:', Object.keys(data[0]).join(', '));
    else console.log('No topics found');
}
main();
