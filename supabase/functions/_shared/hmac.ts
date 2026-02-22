/**
 * HMAC-SHA256 signature validation for n8n webhook callbacks.
 * Reads X-N8N-Signature header and compares against computed HMAC of the body.
 */

const encoder = new TextEncoder();

async function computeHmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

/**
 * Validates the HMAC signature on an incoming request.
 * Returns the parsed body on success, or null on failure.
 */
export async function validateHmac(
  req: Request,
): Promise<{ valid: true; body: string } | { valid: false; error: string }> {
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET");
  if (!secret) {
    return { valid: false, error: "Server misconfiguration: missing webhook secret" };
  }

  const signature = req.headers.get("x-n8n-signature");
  if (!signature) {
    return { valid: false, error: "Missing X-N8N-Signature header" };
  }

  const body = await req.text();
  const expected = await computeHmac(secret, body);

  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true, body };
}
