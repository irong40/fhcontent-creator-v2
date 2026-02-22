import { corsHeaders } from "../_shared/cors.ts";
import { validateHmac } from "../_shared/hmac.ts";
import { getServiceClient } from "../_shared/supabase.ts";

/**
 * n8n-publish-callback
 * Receives: { content_piece_id: string, platform: string, platform_post_id: string, published_at: string }
 * Updates content_pieces.published_platforms JSONB and creates a published_log row.
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
    const { content_piece_id, platform, platform_post_id, published_at } =
      JSON.parse(hmacResult.body);

    if (!content_piece_id || !platform || !platform_post_id || !published_at) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Missing required fields: content_piece_id, platform, platform_post_id, published_at",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = getServiceClient();

    // Fetch the content piece to get topic info and current published_platforms
    const { data: piece, error: fetchError } = await supabase
      .from("content_pieces")
      .select("topic_id, published_platforms")
      .eq("id", content_piece_id)
      .single();

    if (fetchError || !piece) {
      return new Response(
        JSON.stringify({
          success: false,
          error: fetchError?.message ?? "Content piece not found",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Merge new platform status into published_platforms
    const platforms = (piece.published_platforms as Record<string, unknown>) ?? {};
    platforms[platform] = {
      status: "published",
      post_id: platform_post_id,
      published_at,
    };

    // Update content piece
    const { error: updateError } = await supabase
      .from("content_pieces")
      .update({
        published_platforms: platforms,
        published_at,
        status: "published",
      })
      .eq("id", content_piece_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ success: false, error: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch topic details for the published_log entry
    const { data: topic } = await supabase
      .from("topics")
      .select("persona_id, title, topic_hash")
      .eq("id", piece.topic_id)
      .single();

    if (topic) {
      const { error: logError } = await supabase.from("published_log").insert({
        persona_id: topic.persona_id,
        topic_id: piece.topic_id,
        topic_title: topic.title,
        topic_hash: topic.topic_hash,
        published_at,
      });

      if (logError) {
        // Log insert failure is non-fatal; the publish itself succeeded
        console.error("published_log insert failed:", logError.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Published ${platform} for content piece ${content_piece_id}`,
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
