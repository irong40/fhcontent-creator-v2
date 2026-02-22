import { corsHeaders } from "../_shared/cors.ts";
import { validateHmac } from "../_shared/hmac.ts";
import { getServiceClient } from "../_shared/supabase.ts";

/**
 * n8n-asset-callback
 * Receives: { content_piece_id: string, asset_type: string, asset_url: string, metadata?: object }
 * Updates the content_pieces table with the delivered asset URL.
 * Also inserts a row into visual_assets for tracking.
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
    const { content_piece_id, asset_type, asset_url, metadata } = JSON.parse(
      hmacResult.body,
    );

    if (!content_piece_id || !asset_type || !asset_url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing required fields: content_piece_id, asset_type, asset_url",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = getServiceClient();

    // Map asset_type to the correct column on content_pieces
    const pieceUpdate: Record<string, unknown> = {};
    switch (asset_type) {
      case "thumbnail":
        pieceUpdate.thumbnail_url = asset_url;
        break;
      case "video":
        pieceUpdate.video_url = asset_url;
        pieceUpdate.produced_at = new Date().toISOString();
        break;
      case "carousel":
        pieceUpdate.carousel_url = asset_url;
        break;
      default:
        // For other asset types, store in visual_assets only
        break;
    }

    // Update content_pieces if we have mapped columns
    if (Object.keys(pieceUpdate).length > 0) {
      const { error: pieceError } = await supabase
        .from("content_pieces")
        .update(pieceUpdate)
        .eq("id", content_piece_id);

      if (pieceError) {
        return new Response(
          JSON.stringify({ success: false, error: pieceError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Insert into visual_assets for tracking
    const { error: assetError } = await supabase.from("visual_assets").insert({
      content_piece_id,
      asset_type,
      source_service: "n8n",
      asset_url,
      metadata: metadata ?? {},
      status: "completed",
    });

    if (assetError) {
      return new Response(
        JSON.stringify({ success: false, error: assetError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Asset (${asset_type}) saved for content piece ${content_piece_id}`,
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
