# Pitfalls Research: n8n Orchestration

**Context**: Replacing 3 Vercel cron jobs with 5 n8n workflows. n8n is self-hosted on a local Windows machine and calls a Vercel-hosted Next.js app's API routes. A Supabase Edge Function handles callbacks (HMAC-SHA256 signed).

**Research date**: 2026-02-22

---

## Critical Mistakes

These are show-stoppers that will silently break the pipeline or cause data corruption if not addressed before go-live.

### CM-1: Zero error handling is the norm (not the exception)

A real audit of an n8n production instance with 847 workflows running for 14 months found total error handling configured: zero. Most workflows fail without any notification, and operators only discover the problem when business metrics tank. n8n does not alert you by default when a workflow fails — it just logs the execution as "error" in the UI and moves on.

**Applies to this project**: If the daily-media cron fires at 6AM and the topic research workflow fails silently, you will have no content pieces generated that day and no indication why.

### CM-2: Workflow deactivation after n8n restart

When n8n restarts (Windows reboot, PM2 restart, update), workflows do not always reactivate their scheduled triggers automatically. This is a documented and repeatedly reported issue in self-hosted deployments. The Schedule Trigger node appears active in the UI, but the internal timer is not registered, and the workflow never fires.

**Applies to this project**: n8n on a local Windows machine will restart every time the machine reboots. Without a health check that verifies workflows are actually firing, you can lose days of scheduled executions without knowing.

**Fix**: After every restart, toggle each workflow off then back on to re-register triggers. Automate this with a startup script.

### CM-3: SQLite is not production-ready for concurrent workflows

The default n8n installation uses SQLite. SQLite produces `SQLITE_BUSY` errors under 10-15 concurrent workflows and does not support concurrent writes safely. n8n's own concurrency lock ("Maximum Concurrent Executions") lives in SQLite and does not provide cluster-wide safety.

**Applies to this project**: 5 workflows with the 10-minute check-status cron firing alongside hourly publish and the 6AM daily-media workflow is enough concurrent load to hit SQLite contention.

**Fix**: Migrate to PostgreSQL before going to production. Set `DB_TYPE=postgresdb` in environment.

### CM-4: The Retry on Fail + Continue on Error interaction is broken

If both "Retry on Fail" AND "On Error: Continue" are configured on the same node, the retry settings (Max Tries, Wait Between Tries) are silently ignored. The node fails exactly once and the workflow continues as if nothing happened. This is a documented bug in n8n's HTTP Request node (GitHub issue #9236).

**Applies to this project**: Any HTTP Request node calling Vercel API routes that has both options enabled will never actually retry.

### CM-5: Missing workflow lock = duplicate content processing

n8n's built-in "Single Execution" toggle prevents a workflow from running twice concurrently, but this lock only applies within a single n8n instance. More critically: if a cron fires while a previous execution is still running and "Single Execution" is off, you get two workflow instances processing the same topic simultaneously, which can create duplicate content_pieces rows in Supabase.

**Applies to this project**: The hourly-publish cron overlapping with a slow HeyGen/ElevenLabs asset generation step is the highest-risk scenario.

---

## Reliability Pitfalls

### RP-1: n8n is offline = webhook calls fail permanently (no queue)

n8n self-hosted does not queue incoming webhook calls when the instance is offline. If your local Windows machine is sleeping, rebooting, or n8n is updating, any webhook fired by Supabase Edge Functions or Vercel during that window is lost forever. The caller receives a connection refused or timeout, and n8n never sees the request.

**Applies to this project**: The Supabase Edge Function callbacks (topic, research, asset, publish) all call n8n webhooks. Any callback fired during downtime is silently dropped.

**Fix**: Implement a "dead letter" mechanism. Store callback intent in a Supabase table. Have the check-status cron poll for unprocessed callbacks older than N minutes and requeue them.

### RP-2: Vercel cold starts can exceed n8n's HTTP Request timeout

Vercel serverless functions on the Hobby/Pro plan can take 2-4 seconds to cold start. If n8n fires an HTTP Request to a Vercel API route that is cold, the request may time out before the function initializes, especially if the API route does heavy imports (Supabase client, AI SDKs). Users have reported 504 gateway timeout errors even when the function's actual execution time is under 200ms — the cold start overhead is the killer.

n8n's HTTP Request node has a default timeout of 300 seconds, which sounds generous, but the real problem is the combination of:
1. n8n waiting for Vercel to respond
2. Vercel's function timing out (10s on Hobby, 60s on Pro)
3. n8n not retrying on timeout by default

**Fix**: Set `maxDuration` in Vercel function config to appropriate values. Keep API routes that n8n calls lightweight (no heavy imports at module level). Add explicit retry logic in n8n with exponential backoff.

### RP-3: HMAC validation fails on whitespace/encoding differences

When validating HMAC-SHA256 signatures in n8n, the most common failure mode is computing the hash against the parsed JSON body rather than the raw request body. JSON parsers normalize whitespace, reorder keys, or drop null values. The signature computed against the parsed object will not match the signature computed by the sender against the raw bytes.

n8n currently does not have native HMAC verification in the Webhook node — it requires a custom Code node. This is a feature proposal that is still open as of early 2026.

**Applies to this project**: Your Supabase Edge Functions use HMAC-SHA256 for callback validation. If the validation Code node reads `$json.body` (parsed) instead of the raw body bytes, every callback will fail signature verification.

**Fix**: Use `$request.body` (raw buffer) for HMAC computation, not `$json`. Validate before any other processing.

### RP-4: Timezone drift causes scheduled executions to shift

n8n uses either the workflow-level timezone, the instance-level `GENERIC_TIMEZONE` env var, or the server OS timezone (in that precedence order). On a Windows machine, the OS timezone may be set to Eastern Time with DST. When DST switches happen, n8n's cron expressions using UTC will fire at the wrong local time. Crons using local time will fire at the wrong UTC time.

**Applies to this project**: The daily-media workflow fires at 6AM. A DST shift can push it to 5AM or 7AM without any warning.

**Fix**: Set `GENERIC_TIMEZONE=America/New_York` explicitly in n8n environment and use UTC internally for all Supabase timestamps.

### RP-5: Workflow not activated after n8n version upgrade

n8n upgrade (npm update, Docker image pull) followed by restart frequently leaves workflows in a "needs re-registration" state where the UI shows "Active" but triggers are not running. This is particularly common with the Schedule Trigger node.

**Fix**: Maintain a post-restart checklist. Run a canary workflow on a 1-minute schedule and alert if it stops firing.

---

## Windows-Specific Issues

### WS-1: PM2 autostart on Windows is unreliable

The recommended process manager for n8n on Windows is PM2, but `pm2 startup` does not work reliably on Windows without additional configuration. Users report that n8n fails to start on boot even with PM2 configured, often because:
- PM2 service runs before Node.js PATH is available
- Windows service user context differs from the interactive user (no PATH, different env vars)
- PM2's Windows service wrapper (`pm2-windows-service`) is unmaintained

**Alternatives ranked by reliability**:
1. **WinSW** (Windows Service Wrapper) — actively maintained, XML config, log rotation
2. **NSSM** (Non-Sucking Service Manager) — widely used but no longer actively developed
3. **Task Scheduler** — fallback; unreliable for process monitoring

**Fix**: Use WinSW or NSSM. Set recovery actions to "Restart Service" on failure. Store the wrapper config in version control.

### WS-2: n8n data directory uses forward slashes in .env but Windows backslashes in practice

n8n environment variables like `N8N_USER_FOLDER` and binary data paths must use forward slashes on Windows when set in `.env` files (Node.js normalizes them), but Windows path errors can still surface in Code nodes that use `path.join()` without the `path` module, or when shelling out to OS commands.

**Fix**: Always use `path.join()` in Code nodes. Never hardcode `\` path separators. Test all file path operations explicitly on the Windows host.

### WS-3: Windows Defender / antivirus interferes with n8n file operations

Windows Defender real-time protection can lock files that n8n tries to read or write, particularly during binary data operations or when n8n writes execution data to disk. This manifests as intermittent `EACCES` or `EPERM` errors that do not reproduce consistently.

**Fix**: Add the n8n data directory (`%USERPROFILE%\.n8n` or custom `N8N_USER_FOLDER`) to Windows Defender exclusions.

### WS-4: Machine sleep/hibernate interrupts running executions

Windows power management can put the machine to sleep during a long-running workflow execution (e.g., a video processing step waiting for an API callback). n8n does not have a mechanism to resume interrupted executions after sleep; the execution is marked as "crashed" or simply disappears from the execution log.

**Fix**: Disable sleep on the machine when n8n is active. Use Windows Task Scheduler or a power plan that prevents sleep when the n8n process is running. Consider keeping the machine always-on or replacing with a VPS for the n8n instance.

### WS-5: n8n webhook URL vs WEBHOOK_URL mismatch

On Windows, n8n auto-detects its public URL incorrectly when behind a reverse proxy (nginx, Caddy) or when using port mapping. The auto-detected URL uses `localhost` or the machine IP, not the public hostname. Webhook URLs shown in the n8n UI will be wrong, and external services trying to call those URLs (e.g., if you copy-paste from the UI) will fail.

**Fix**: Always set `WEBHOOK_URL=https://your-public-domain.com/` explicitly in environment. Never rely on auto-detection.

---

## Error Handling Anti-Patterns

### EH-1: Error Trigger workflow is optional — most people skip it

n8n has a global "Error Workflow" concept: you designate one workflow as the error handler and it receives a payload whenever any other workflow fails. This is opt-in and must be configured in Settings > Error Workflow. The majority of n8n deployments never configure this, so all workflow failures are silent.

**Fix**: Create an error handler workflow immediately. Connect it to Slack/email/Supabase logging. Set it as the global error workflow before activating any production workflows.

### EH-2: "Continue on Fail" applied globally breaks the entire contract

Many n8n tutorials recommend enabling "Continue on Fail" on nodes to make workflows "resilient." What actually happens: the node's error output is passed downstream as if it succeeded, so every subsequent node processes an error object thinking it is real data. The workflow completes with a green checkmark while having processed corrupted data throughout.

**Applies to this project**: If an HTTP Request to the Vercel API returns an error and "Continue on Fail" is on, the next node that tries to extract `content_piece_id` from the response will get `undefined`, and the downstream Supabase write will insert a null or malformed row.

**Fix**: Apply "Continue on Fail" only at nodes where partial failure is genuinely acceptable and handle the error branch explicitly with an IF node checking for `$json.error`.

### EH-3: Infinite retry loops when community nodes are missing

A documented n8n bug (GitHub issue #18501): when a workflow references a community node that is not installed, n8n enters a retry loop attempting to activate the workflow on startup. Each retry fails, triggers another retry, and the instance becomes progressively unstable — consuming CPU, filling logs, and potentially crashing the process.

**Fix**: Document all community node dependencies. Verify all required nodes are installed immediately after n8n restarts. Add to the post-restart checklist.

### EH-4: No maximum retry ceiling on looping sub-flows

When implementing polling loops (e.g., poll HeyGen every 30s until video is ready), forgetting to add a counter + IF node that breaks the loop after N iterations creates an infinite loop. The loop runs until n8n's execution timeout kills it or memory is exhausted.

**Applies to this project**: The check-status cron workflow polling for asset completion is high risk for this pattern.

**Fix**: Always implement: `counter = counter + 1` → IF `counter > MAX_RETRIES` → "Fail with error" branch. Set MAX_RETRIES based on realistic maximum job duration.

### EH-5: API error codes not distinguished from network failures

HTTP 429 (rate limit), HTTP 503 (Vercel cold-start/overload), and network timeout are three different failure modes requiring different responses:
- 429: back off and retry after Retry-After header
- 503: retry with exponential backoff
- Timeout: check if the operation actually completed before retrying (idempotency)

n8n's built-in retry logic does not distinguish between these. Retrying a 429 immediately will get you banned faster. Retrying a timeout without idempotency check will create duplicate records.

**Fix**: Use a Code node after HTTP Request to classify the error type, then branch to appropriate retry logic. For operations that may have succeeded before timeout (e.g., content piece creation), check Supabase for the record before retrying the create.

---

## Performance / Scale Pitfalls

### PS-1: Default 16MB payload limit breaks large AI responses

n8n's default `N8N_PAYLOAD_SIZE_MAX` is 16MB. This was designed for typical API responses. AI-generated content (long-form articles, transcripts, research documents) with embedded metadata can exceed this limit, producing the error: "Existing execution data is too large."

**Applies to this project**: Research documents, full article drafts, and podcast transcripts passed as node data can approach or exceed 16MB when combined with metadata.

**Fix**: Increase `N8N_PAYLOAD_SIZE_MAX` in n8n environment. As a rule: set to no more than 20% of available RAM. For a machine with 16GB RAM, 3GB is the safe ceiling. Prefer storing large content in Supabase and passing only IDs between nodes.

### PS-2: Node.js heap exhaustion crashes the entire n8n instance

n8n runs on Node.js with a default heap size of 512MB–1.7GB depending on the system. When a workflow processes large datasets or multiple binary files simultaneously, Node.js heap overflow causes the entire n8n process to crash, killing all currently running executions.

The error in logs: `FATAL ERROR: Allocation failed - JavaScript heap out of memory`

**Fix**: Set `NODE_OPTIONS=--max-old-space-size=4096` in the n8n startup environment to allocate 4GB heap. Process binary assets in streams rather than loading entire files into Code nodes. Use binary data filesystem mode instead of in-memory mode for large files.

### PS-3: All inter-node data accumulates in a single execution context

Every item passed through every node in a workflow is held in memory for the lifetime of the execution. A workflow that fetches 50 AI-generated content pieces, enriches each with metadata, generates images, and then publishes — all in one workflow — will hold all 50 items in memory simultaneously throughout.

**Fix**: Use sub-workflows. The parent workflow passes one ID to a sub-workflow, which does all processing for that item, stores results in Supabase, and returns only a status string. Memory is freed after each sub-workflow call. Do not pass large data objects between parent and sub-workflow — pass IDs.

### PS-4: Execution history database growth degrades performance

n8n stores full execution data (input/output of every node) in its database by default, with no automatic pruning. On SQLite, after thousands of executions with large payloads, the database grows to gigabytes and query performance degrades significantly — the n8n UI becomes slow and workflow activation takes longer.

**Fix**: Set `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168` (7 days) in environment. Use PostgreSQL instead of SQLite for better performance at scale.

### PS-5: Concurrent AI API calls trigger rate limits

n8n's "Split In Batches" with default settings fires all items in a batch as concurrent HTTP requests. Five simultaneous Claude API calls or ElevenLabs TTS requests will hit rate limits immediately, producing a cascade of 429 errors.

**Fix**: Use the "Wait" node between API calls. Set batch size to 1 for expensive AI APIs. Implement exponential backoff using a Code node that reads the `Retry-After` header.

---

## Security Pitfalls

### SEC-1: Critical RCE vulnerability in n8n versions 1.65–1.120.4 (CVE-2026-21858, CVSS 10.0)

A critical vulnerability was disclosed in January 2026 affecting n8n versions 1.65 through 1.120.4. The vulnerability originates from a Content-Type confusion flaw in n8n's webhook and file-handling logic. Attackers can forge requests to webhook endpoints without authentication, access sensitive files including the encryption key file, forge admin sessions, and achieve arbitrary code execution on the host machine.

**This is not theoretical — CVSS is 10.0 (maximum score).**

**Fix**: Upgrade to n8n version 1.121.0 or later immediately. Verify current version with `npm list n8n` or `n8n --version`. Do not expose n8n's UI or webhook URLs to the public internet.

### SEC-2: Webhook URLs are unauthenticated by default

n8n webhook URLs are public endpoints with no authentication by default. The URL structure is predictable: `https://your-n8n-host/webhook/<uuid>`. Anyone who discovers the URL can trigger your workflows with arbitrary payloads.

**Fix for this project**: All incoming webhooks from Supabase Edge Functions must be verified with HMAC-SHA256 before processing. The verification Code node must run as the first step before any data processing. Return HTTP 401 immediately if verification fails — do not process further.

### SEC-3: Encryption key defaults to auto-generated and is stored in ~/.n8n

By default, n8n generates a random encryption key on first launch and stores it in `~/.n8n/config`. If this file is deleted (e.g., during a reinstall, OS migration, or Windows profile issue), all stored credentials become permanently unrecoverable.

Additionally, if `N8N_ENCRYPTION_KEY` is not set as an environment variable, different n8n instances (e.g., after reinstall) cannot read credentials encrypted with the old key.

**Fix**: Set `N8N_ENCRYPTION_KEY` as an explicit environment variable. Store it in a password manager or secrets vault. Back up the value separately from the machine.

### SEC-4: Credentials visible in workflow execution logs

n8n execution logs store the full input and output of every node, including HTTP Request headers, which may contain `Authorization: Bearer <token>` values. Anyone with access to the n8n UI or who can read the database can extract API keys from execution history.

**Fix**: Store all secrets in n8n's Credential Manager, never hardcode them in workflow nodes. Enable execution data pruning so logs do not accumulate indefinitely. Restrict n8n UI access to localhost only — do not expose port 5678 externally.

### SEC-5: n8n process runs as the Windows user account with full permissions

When n8n runs via PM2 or NSSM as the logged-in Windows user, it inherits that user's full file system permissions. A successful exploit (e.g., via CVE-2026-21858 or a malicious webhook payload processed by a Code node using `require('child_process')`) gives the attacker full access to the Windows machine, including all files and network shares.

**Fix**: Create a dedicated low-privilege Windows user account for n8n. Run the n8n service under that account. The account should have access only to the n8n data directory and should have no network drive mappings or privileged application access.

### SEC-6: Supabase service role key exposure in n8n credentials

The Supabase `service_role` key bypasses Row Level Security entirely. If stored in n8n and leaked via execution logs, credential export, or the CVE above, an attacker gains full read/write access to the entire Supabase database.

**Fix**: Use the `anon` key with RLS for n8n workflows where possible. Only use `service_role` for admin operations that genuinely require it. Store the service role key in n8n Credential Manager with the `N8N_ENCRYPTION_KEY` explicitly set (see SEC-3).

---

## Prevention Strategies

### For CM-1 (Silent failures)
- **Warning sign**: Workflow execution log shows errors in the UI but no notification is sent.
- **Prevention**: Configure a global Error Workflow on day 1 before any production workflow is activated. Connect it to Slack or email. Test it by deliberately breaking a workflow.

### For CM-2 (Trigger deactivation after restart)
- **Warning sign**: Workflow shows "Active" in UI but last execution time does not update on schedule.
- **Prevention**: Write a canary workflow on a 1-minute Schedule Trigger that writes a heartbeat timestamp to Supabase. Monitor the `last_heartbeat` column from outside n8n (Supabase cron or external monitoring). Alert if heartbeat is older than 3 minutes.

### For CM-3 (SQLite concurrency)
- **Warning sign**: n8n logs show `SQLITE_BUSY` or `database is locked` errors. UI becomes sluggish with multiple concurrent executions.
- **Prevention**: Migrate to PostgreSQL before activating more than 2 concurrent workflows.

### For CM-4 (Retry + Continue conflict)
- **Warning sign**: HTTP Request node has both "Retry on Fail" and "Continue on Error" enabled.
- **Prevention**: Audit all workflow nodes for this combination before go-live. Never enable both simultaneously.

### For CM-5 (Duplicate processing)
- **Warning sign**: Duplicate rows appearing in `content_pieces` or `published_log` after a slow execution.
- **Prevention**: Enable "Single Execution" on all schedule-triggered workflows. Add a Supabase check at the start of each workflow to verify the job is not already in-progress (use `workflow_locks` table which is already in the schema).

### For RP-1 (Offline webhook loss)
- **Warning sign**: Supabase Edge Function logs show failed callback deliveries; n8n has no record of receiving them.
- **Prevention**: In Supabase Edge Functions, after calling the n8n webhook, update a `callback_status` column. The check-status workflow polls for `callback_status = 'pending'` older than 5 minutes and requeues them.

### For RP-2 (Vercel cold starts)
- **Warning sign**: Intermittent timeout errors from n8n to Vercel, especially on API routes not recently called.
- **Prevention**: Enable Vercel Fluid Compute. Keep API routes that n8n calls lean (lazy-load heavy imports). Set n8n HTTP Request timeout to 60 seconds minimum for Vercel endpoints.

### For RP-3 (HMAC validation)
- **Warning sign**: Every callback from Supabase is rejected with 401; manual requests with raw bodies succeed.
- **Prevention**: Test HMAC validation in isolation with a known payload before wiring it into production. Log the raw body hash and received hash side by side when validation fails.

### For WS-1 (PM2 autostart)
- **Warning sign**: After a Windows reboot, n8n is not running and the canary workflow has stopped sending heartbeats.
- **Prevention**: Use WinSW instead of PM2 for Windows service management. Configure service recovery actions to restart on failure. Test the full reboot cycle before go-live.

### For WS-4 (Sleep/hibernate)
- **Warning sign**: Long-running executions disappear from the execution log with status "crashed" or no status.
- **Prevention**: Set Windows power plan to "High Performance" or create a custom plan that never sleeps. Add this to the deployment checklist.

### For SEC-1 (CVE-2026-21858)
- **Warning sign**: Running n8n version between 1.65 and 1.120.4.
- **Prevention**: Run `n8n --version` immediately. If below 1.121.0, upgrade before doing anything else.

### For EH-4 (Infinite loops)
- **Warning sign**: A workflow execution has been running for hours; execution log shows thousands of iterations.
- **Prevention**: Every loop in every workflow must have a counter and a circuit breaker. Set `EXECUTIONS_TIMEOUT_MAX` as an absolute ceiling for the n8n instance.

### For PS-1 (Payload size)
- **Warning sign**: "Existing execution data is too large" error in execution log.
- **Prevention**: Design all workflows to pass IDs through nodes, not content bodies. Store content in Supabase. Retrieve only what is needed at each node.

---

## Phase Mapping

Mapping pitfalls to the 7-phase / 14-week build timeline for proactive prevention.

### Phase 1 — Foundation / n8n Setup (Weeks 1-2)
Address before writing any workflow:
- **SEC-1**: Verify n8n version >= 1.121.0
- **CM-3**: Configure PostgreSQL as n8n database (not SQLite)
- **SEC-3**: Set `N8N_ENCRYPTION_KEY` explicitly; back up the value
- **WS-1**: Configure WinSW service with recovery actions; test reboot
- **WS-4**: Set Windows power plan to never sleep
- **WS-5**: Set `WEBHOOK_URL` explicitly in environment
- **PS-4**: Set `EXECUTIONS_DATA_PRUNE=true` and `EXECUTIONS_DATA_MAX_AGE=168`
- **RP-4**: Set `GENERIC_TIMEZONE=America/New_York` in n8n environment

### Phase 2 — Error Infrastructure (Before activating any production workflow)
- **CM-1**: Create and activate the global Error Workflow (Slack/email notification)
- **CM-2**: Create the canary heartbeat workflow; set up external monitoring on `last_heartbeat`
- **EH-1**: Confirm Error Trigger is set as the global error workflow in Settings

### Phase 3 — Webhook Security (Before connecting Supabase Edge Functions)
- **RP-3**: Implement and test HMAC validation Code node in isolation
- **SEC-2**: Document all n8n webhook URLs; confirm none are exposed publicly
- **SEC-4**: Verify execution log pruning is active; confirm credentials are in Credential Manager
- **SEC-5**: Create dedicated low-privilege Windows user for n8n service
- **SEC-6**: Audit which Supabase key (anon vs service_role) each workflow uses

### Phase 4 — Workflow Implementation
Address per-workflow during development:
- **CM-4**: Do not use "Retry on Fail" + "Continue on Error" simultaneously on any node
- **CM-5**: Use `workflow_locks` table at workflow entry point to prevent duplicate runs
- **EH-2**: Apply "Continue on Fail" only where explicitly needed with explicit error branch
- **EH-4**: Add counter + circuit breaker to every polling loop
- **EH-5**: Add error classification Code node after every external HTTP Request

### Phase 5 — Performance Hardening (Before load/stress testing)
- **PS-1**: Set `N8N_PAYLOAD_SIZE_MAX` in environment; refactor workflows to pass IDs not content
- **PS-2**: Set `NODE_OPTIONS=--max-old-space-size=4096` in n8n startup
- **PS-3**: Convert large single workflows to parent + sub-workflow patterns
- **PS-5**: Add Wait nodes between AI API calls; implement Retry-After header handling

### Phase 6 — Reliability Testing
- **RP-1**: Simulate n8n downtime; verify callback requeue mechanism works
- **RP-2**: Test all Vercel API routes from cold state; measure cold start latency; tune timeouts
- **WS-2**: Verify all file paths in Code nodes work with Windows paths
- **WS-3**: Add n8n data directory to Windows Defender exclusions; test file operations

### Phase 7 — Pre-Launch Checklist
- **CM-2**: Confirm canary heartbeat is green
- **SEC-1**: Re-verify n8n version
- **WS-1**: Perform full reboot test; confirm all 5 workflows re-activate automatically
- **EH-3**: Verify all required community nodes are installed; document in deployment notes
- **RP-5**: Run a controlled n8n version upgrade; verify triggers re-register afterward

---

## Sources

- [n8n Error Handling Patterns: Retry, Dead Letter, Circuit Breaker](https://www.pagelines.com/blog/n8n-error-handling-patterns)
- [Stop Silent Failures: n8n Error Handling System](https://nextgrowth.ai/n8n-workflow-error-alerts-guide/)
- [n8n Workflow Activation Infinite Retry Loop — GitHub Issue #18501](https://github.com/n8n-io/n8n/issues/18501)
- [HTTP Request Node Incompatible Error Handling — GitHub Issue #9236](https://github.com/n8n-io/n8n/issues/9236)
- [Memory-related errors — n8n Docs](https://docs.n8n.io/hosting/scaling/memory-errors/)
- [Configure workflow timeout settings — n8n Docs](https://docs.n8n.io/hosting/configuration/configuration-examples/execution-timeout/)
- [Binary data — n8n Docs](https://docs.n8n.io/data/binary-data/)
- [Concurrency control — n8n Docs](https://docs.n8n.io/hosting/scaling/concurrency-control/)
- [External secrets — n8n Docs](https://docs.n8n.io/external-secrets/)
- [Set a custom encryption key — n8n Docs](https://docs.n8n.io/hosting/configuration/configuration-examples/encryption-key/)
- [Critical n8n Vulnerability CVE-2026-21858 (CVSS 10.0) — The Hacker News](https://thehackernews.com/2026/01/critical-n8n-vulnerability-cvss-100.html)
- [Security Advisory n8n versions 1.65–1.120.4 — n8n Blog](https://blog.n8n.io/security-advisory-20260108/)
- [The Ni8mare Test: n8n RCE Under the Microscope — Horizon3.ai](https://horizon3.ai/attack-research/attack-blogs/the-ni8mare-test-n8n-rce-under-the-microscope-cve-2026-21858/)
- [Lock Down n8n Webhooks Before They Bite — Medium](https://medium.com/@Nexumo_/lock-down-n8n-webhooks-before-they-bite-769e6e8768a0)
- [How to Secure n8n Workflows — Reco.ai](https://www.reco.ai/hub/secure-n8n-workflows)
- [Solving n8n "Existing execution data is too large" Error — tva.sg](https://www.tva.sg/solving-n8n-existing-execution-data-is-too-large-error-the-complete-fix-for-self-hosted-instances/)
- [n8n Race Conditions (Parallel Execution Bugs) — flowgenius.in](https://flowgenius.in/n8n-race-conditions-parallel-executions/)
- [Redis locking for concurrent task handling — n8n workflow template](https://n8n.io/workflows/3444-redis-locking-for-concurrent-task-handling/)
- [n8n Batch Processing: Handle Large Datasets Without Crashing](https://logicworkflow.com/blog/n8n-batch-processing/)
- [Vercel Functions Timing Out — Vercel Knowledge Base](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out)
- [Vercel Cold Start Performance — Vercel Knowledge Base](https://vercel.com/kb/guide/how-can-i-improve-serverless-function-lambda-cold-start-performance-on-vercel)
- [Can't auto start n8n with pm2 on Windows — n8n Community](https://community.n8n.io/t/cant-auto-start-n8n-with-pm2-on-windows/86878)
- [Run n8n as a Service with PM2 — n8n Community](https://community.n8n.io/t/run-n8n-as-a-service-with-pm2/1199)
- [Schedule Trigger node common issues — n8n Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/common-issues/)
- [Webhook HMAC hash cannot be verified — n8n Community](https://community.n8n.io/t/webhook-hmac-hash-cannot-be-verified/46100)
- [Mastering the n8n Webhook Node: Part B — AutomateGeniusHub](https://automategeniushub.com/mastering-the-n8n-webhook-node-part-b/)
- [From Scripts to Systems: Your Cron-to-n8n Upgrade — Medium](https://medium.com/@bhagyarana80/from-scripts-to-systems-your-cron-to-n8n-upgrade-e3c39e9c37ff)
