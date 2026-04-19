import { createClient } from '@supabase/supabase-js';
async function main() {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb.from('topics').select('id, title').eq('persona_id','6ac9adfa-27f1-492b-98e1-f5623cb4eda2').eq('status','draft').single();
    console.log(data?.id, '|', data?.title);
}
main();
