import { corsHeaders } from "../_shared/cors.ts";
import { validateHmac } from "../_shared/hmac.ts";
import { getServiceClient } from "../_shared/supabase.ts";

/**
 * n8n-research-callback
 * Receives: { topic_id: string, sources: [{ url: string, title: string, summary: string }] }
 * Stores research sources in topics.historical_points JSONB since
 * a dedicated research_documents table does not yet exist.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Validate HMAC signature
  const hmacResult = await validateHmac(req);
  if (!hmacResult.valid) {
    return new Response(
      JSON.stringify({ success: false, error: hmacResult.error }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { topic_id, sources } = JSON.parse(hmacResult.body);

    if (!topic_id || !Array.isArray(sources)) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: topic_id, sources[]" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = getServiceClient();

    // Fetch current historical_points so we can merge research sources in
    const { data: topic, error: fetchError } = await supabase
      .from("topics")
      .select("historical_points")
      .eq("id", topic_id)
      .single();

    if (fetchError) {
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Merge: keep existing historical_points array, append a _research_sources key
    const existingPoints = topic?.historical_points ?? [];
    const merged = {
      points: Array.isArray(existingPoints) ? existingPoints : [],
      _research_sources: sources.map(
        (s: { url: string; title: string; summary: string }) => ({
          url: s.url,
          title: s.title,
          summary: s.summary,
          added_at: new Date().toISOString(),
        }),
      ),
    };

    const { error: updateError } = await supabase
      .from("topics")
      .update({ historical_points: merged })
      .eq("id", topic_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Stored ${sources.length} research sources for topic ${topic_id}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
