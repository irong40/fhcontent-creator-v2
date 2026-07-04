#!/usr/bin/env bash
# Apply a freshly-regenerated Blotato API key everywhere it lives, redeploy, and
# kick the publisher so staged content ships immediately.
#
# Usage:  bash scripts/apply-blotato-key.sh "<NEW_BLOTATO_KEY>"
#
# Built 2026-06-29 after the Blotato key went 401 across every store and blocked
# all publishing. Idempotent; safe to re-run on the next rotation.
set -euo pipefail

KEY="${1:-}"
if [ -z "$KEY" ]; then echo "ERROR: pass the new Blotato key as arg 1"; exit 1; fi

REPO="D:/Projects/fhcontent-creator-v2"
ENVLOCAL="$REPO/.env.local"
APIKEYS="D:/Projects/info/apikeys.txt"
BASE="https://backend.blotato.com/v2"

echo "==> 1/6 Verify the new key against Blotato"
code=$(curl -s -o /dev/null -w "%{http_code}" -H "blotato-api-key: $KEY" "$BASE/users/me")
if [ "$code" != "200" ]; then echo "ABORT: new key returned HTTP $code (expected 200)"; exit 1; fi
echo "    key OK (HTTP 200)"

echo "==> 2/6 Update $ENVLOCAL"
if grep -qE "^BLOTATO_API_KEY=" "$ENVLOCAL"; then
  # portable in-place edit
  tmp=$(mktemp); grep -vE "^BLOTATO_API_KEY=" "$ENVLOCAL" > "$tmp"; printf 'BLOTATO_API_KEY=%s\n' "$KEY" >> "$tmp"; mv "$tmp" "$ENVLOCAL"
else printf 'BLOTATO_API_KEY=%s\n' "$KEY" >> "$ENVLOCAL"; fi
echo "    .env.local updated"

echo "==> 3/6 Update canonical key store ($APIKEYS)"
[ -f "$APIKEYS" ] && { tmp=$(mktemp); awk -v k="$KEY" 'tolower($0) ~ /^blotato/ {print; getline; print k; next} {print}' "$APIKEYS" > "$tmp" 2>/dev/null && mv "$tmp" "$APIKEYS" || echo "    (apikeys.txt manual check advised)"; }

echo "==> 4/6 Update Vercel production env + redeploy"
cd "$REPO"
vercel env rm BLOTATO_API_KEY production -y 2>/dev/null || true
printf '%s' "$KEY" | vercel env add BLOTATO_API_KEY production
vercel --prod --yes

echo "==> 5/6 Trigger daily-publish to ship staged content now"
CRON=$(grep -E "^CRON_SECRET=" "$ENVLOCAL" | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')
curl -s -H "Authorization: Bearer $CRON" "https://fhcontent-creator-v2.vercel.app/api/cron/daily-publish" | head -c 800; echo

echo "==> 6/6 Done. Check Supabase content_pieces.published_platforms for fresh post IDs."
