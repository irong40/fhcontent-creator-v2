import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Creates a Supabase client using the service role key.
 * This bypasses RLS so the edge functions can write to any table.
 */
export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}
