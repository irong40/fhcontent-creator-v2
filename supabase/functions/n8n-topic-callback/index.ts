import { corsHeaders } from "../_shared/cors.ts";
import { validateHmac } from "../_shared/hmac.ts";
import { getServiceClient } from "../_shared/supabase.ts";

/**
 * n8n-topic-callback
 * Receives: { topic_id: string, status: string, error_message?: string }
 * Updates the topics table with the new status.
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
    const { topic_id, status, error_message } = JSON.parse(hmacResult.body);

    if (!topic_id || !status) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: topic_id, status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = getServiceClient();

    const updateData: Record<string, unknown> = { status };
    if (error_message) {
      updateData.error_message = error_message;
    }
    // Set timestamp fields based on status transitions
    if (status === "content_ready") {
      updateData.content_ready_at = new Date().toISOString();
    } else if (status === "published") {
      updateData.published_at = new Date().toISOString();
    } else if (status === "failed") {
      // Increment retry count on failure
      const { data: current } = await supabase
        .from("topics")
        .select("retry_count")
        .eq("id", topic_id)
        .single();
      if (current) {
        updateData.retry_count = (current.retry_count ?? 0) + 1;
      }
    }

    const { error } = await supabase
      .from("topics")
      .update(updateData)
      .eq("id", topic_id);

    if (error) {
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: `Topic ${topic_id} updated to ${status}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
