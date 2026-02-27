# Phase 3: Webhook Security — STATE

## Status: NEAR-COMPLETE (pending HMAC test run)

### 03-01: HMAC Signing Spike — DONE
- N8N_WEBHOOK_SECRET generated: 64-char hex in `D:/n8n/.env`
- Same secret set in Supabase as `N8N_WEBHOOK_SECRET` (via `supabase secrets set`)
- All 4 edge functions redeployed to pick up secret
- n8n restarted and healthy
- CLI spike confirmed: valid HMAC → 500 (past auth, fake UUID), tampered → 401
- **KEY FINDING**: Edge functions use `N8N_WEBHOOK_SECRET` env var (not `HMAC_SECRET` as plan assumed)
- **KEY FINDING**: Signature header is raw hex (no `sha256=` prefix)
- **KEY FINDING**: n8n Code nodes block `require('crypto')` — must use Web Crypto API (`crypto.subtle`)
- **KEY FINDING**: `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` is default — use Set node to pass secret to Code nodes

### 03-02: HMAC Test All Functions — PENDING TEST RUN
- Workflow ID: `9ySj9GyA67n973G5`
- Tests all 4 edge functions with valid + tampered signatures
- Uses Web Crypto API (not Node.js crypto module)
- User needs to run "Test workflow" and confirm 4/4 PASS

### 03-03: ROTATION.md — DONE
- File: `n8n-workflows/ROTATION.md`
- 8-step rotation procedure with rollback
- SEC-04 confirmed (port 5678 loopback-only)
- SEC-05 not yet implemented (no cron workflows until Phase 4+)

## n8n API Key
- Stored in n8n Settings → API
- Used for programmatic workflow creation

## Workflow IDs
| Workflow | ID | Active |
|----------|-----|--------|
| WF-Error-Handler | J7uiOgEm6YQPCq8F | Yes |
| Canary — Heartbeat | x4u1w7DSQetH3n3g | Yes |
| HMAC-Test-All-Functions | 9ySj9GyA67n973G5 | No (manual) |
| Canary — Timezone Validation | canary-tz-001 | No (replaced) |
| Sentinel Folder Watcher - Receiver | sentinel-fw-v2 | Yes |
| Sentinel Package Router | sentinel-pr-v2 | Yes |
