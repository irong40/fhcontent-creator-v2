# N8N_WEBHOOK_SECRET Rotation Runbook

**Last Updated**: 2026-02-26
**Affects**: All n8n workflows that call Supabase Edge Functions with HMAC signing
**Secrets**: `N8N_WEBHOOK_SECRET` in D:/n8n/.env + `N8N_WEBHOOK_SECRET` in Supabase Edge Function env
**Both must always be identical.**

## When to Rotate
- Immediately if exposed in logs, commits, or screenshots
- Every 90 days (routine rotation)
- After team member with access leaves
- After suspected compromise

## Pre-Rotation Checklist
- [ ] Confirm all HMAC-using workflows documented below
- [ ] Schedule during low-traffic window (content jobs run at 6 AM ET)
- [ ] Have Supabase dashboard and D:/n8n/ access ready
- [ ] Have HMAC-Test-All-Functions workflow ready to verify post-rotation

## Workflows Using HMAC Signing
Update this list as new workflows are added:

| Workflow | Phase | Uses HMAC |
|----------|-------|-----------|
| HMAC-Test-All-Functions | 3 | Yes — test workflow |
| WF-Daily-Media | 4 | Yes (planned) |
| WF-Daily-Publish | 5 | Yes (planned) |
| WF-Status-Check | 6 | Yes (planned) |

## ROTATION STEPS

### Step 1: Generate new secret
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy output (NEW_SECRET). Keep old secret available until Step 6.

### Step 2: Update Supabase Edge Function secret FIRST
Updating Supabase before n8n creates a brief window where Supabase expects NEW but n8n sends OLD — workflows will return 401. This window is minimized in Step 4.

```bash
cd D:/Projects/fhcontent-creator-v2
npx supabase secrets set N8N_WEBHOOK_SECRET=<NEW_SECRET> --project-ref qjpujskwqaehxnqypxzu
```

### Step 3: Redeploy all 4 Edge Functions
Edge functions read secrets at deploy time:

```bash
npx supabase functions deploy n8n-topic-callback --project-ref qjpujskwqaehxnqypxzu
npx supabase functions deploy n8n-research-callback --project-ref qjpujskwqaehxnqypxzu
npx supabase functions deploy n8n-asset-callback --project-ref qjpujskwqaehxnqypxzu
npx supabase functions deploy n8n-publish-callback --project-ref qjpujskwqaehxnqypxzu
```

Each deploy takes ~30-60 seconds. Total downtime window: ~2-4 minutes.

### Step 4: Update N8N_WEBHOOK_SECRET in D:/n8n/.env
```
N8N_WEBHOOK_SECRET=<NEW_SECRET>
```
Save file.

### Step 5: Update secret in n8n workflow Set nodes
Because `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` (default), the secret is passed via Set nodes, not `$env`.

For each workflow in the "Workflows Using HMAC Signing" table:
1. Open in n8n UI
2. Find the "Set Secret" node
3. Update `webhookSecret` field to NEW_SECRET
4. Save workflow (Ctrl+S)

### Step 6: Restart n8n
```bash
cd D:/n8n
docker compose restart n8n
```
Wait 15 seconds. Verify:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5678/healthz
```
Expected: `200`

### Step 7: Verify rotation with HMAC test workflow
Run HMAC-Test-All-Functions workflow in n8n UI:
- All 4 valid-signature tests: **200**
- All 4 tampered-signature tests: **401**

If any valid test returns 401: secret is out of sync — check Step 2-5.

### Step 8: Update exported JSON in version control
Re-export HMAC-signing workflows from n8n. Replace actual secret with placeholder before committing:

```bash
cd D:/Projects/fhcontent-creator-v2/n8n-workflows
python3 -c "
import json, re, sys, glob
for f in glob.glob('*.json'):
    with open(f, 'r') as fh:
        content = fh.read()
    sanitized = re.sub(r'[0-9a-f]{64}', 'REPLACE_WITH_N8N_WEBHOOK_SECRET', content)
    if sanitized != content:
        with open(f, 'w') as fh:
            fh.write(sanitized)
        print(f'Sanitized: {f}')
"
```

## Post-Rotation Checklist
- [ ] D:/n8n/.env has NEW_SECRET
- [ ] All 4 Supabase edge functions redeployed with NEW_SECRET
- [ ] All n8n workflow Set nodes updated
- [ ] HMAC test passes (all valid=200, all tampered=401)
- [ ] Old secret no longer stored anywhere accessible
- [ ] Version control updated with sanitized JSON exports
- [ ] Rotation date recorded in Rotation History below

## Rollback Procedure
If rotation fails (workflows returning 401 for valid signatures):

1. **Revert Supabase secret** to OLD_SECRET:
   ```bash
   npx supabase secrets set N8N_WEBHOOK_SECRET=<OLD_SECRET> --project-ref qjpujskwqaehxnqypxzu
   npx supabase functions deploy n8n-topic-callback --project-ref qjpujskwqaehxnqypxzu
   npx supabase functions deploy n8n-research-callback --project-ref qjpujskwqaehxnqypxzu
   npx supabase functions deploy n8n-asset-callback --project-ref qjpujskwqaehxnqypxzu
   npx supabase functions deploy n8n-publish-callback --project-ref qjpujskwqaehxnqypxzu
   ```

2. **Revert D:/n8n/.env** to OLD_SECRET and restart:
   ```bash
   # Edit D:/n8n/.env, restore OLD_SECRET
   cd D:/n8n && docker compose restart n8n
   ```

3. **Revert n8n workflow Set nodes** to OLD_SECRET

4. **Re-run HMAC test** to confirm rollback succeeded

5. **Investigate root cause** before attempting rotation again

## Security Controls Inventory

### SEC-04: Port 5678 Loopback-Only Binding
- **Status**: CONFIRMED
- **Evidence**: `docker-compose.yml` line 25: `"127.0.0.1:5678:5678"`
- **Re-verify**: `netstat -an | grep 5678 | grep LISTENING` — expect `127.0.0.1:5678`
- **Why it matters**: Prevents unauthorized LAN access. Cloudflare Tunnel connects to 127.0.0.1:5678 internally, so external access is unaffected.
- **Does rotation change this?** No. Port binding is separate from secrets.

### SEC-05: CRON_SECRET Header Validation
- **Status**: NOT YET IMPLEMENTED (no cron workflows exist until Phase 4+)
- **When required**: Before any scheduled workflow that triggers paid API calls goes live
- **Rotation**: CRON_SECRET is independent of N8N_WEBHOOK_SECRET. Rotate separately if compromised.
- **During N8N_WEBHOOK_SECRET rotation**: CRON_SECRET requires NO changes.
- **Re-verify**: `grep CRON_SECRET D:/n8n/.env`

### Edge Function HMAC Implementation
- **Shared module**: `supabase/functions/_shared/hmac.ts`
- **Algorithm**: HMAC-SHA256 via Web Crypto API (`crypto.subtle`)
- **Header**: `X-N8N-Signature` (raw hex digest, no `sha256=` prefix)
- **Timing-safe comparison**: Yes (`timingSafeEqual` function)
- **Env var name in edge functions**: `N8N_WEBHOOK_SECRET` (via `Deno.env.get`)

## Rotation History
| Date | Rotated By | Reason | Verification Result |
|------|-----------|--------|---------------------|
| 2026-02-26 | Initial | First provisioning (Phase 3, Plan 03-01) | Pending |

_Add a row each time rotation is performed._
