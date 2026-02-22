# Features Research: n8n Workflow Patterns

> Researched 2026-02-22 for FHContent Creator v2 (Content Command Center)
> Target: 5 workflows — Content Generation, Media Production, Status Monitor, Publishing, Error Handler

---

## Table Stakes

These are non-negotiable features that every production n8n orchestration must implement. Skipping any of these leads to brittle, unrecoverable, or undebuggable pipelines.

### 1. Error Trigger Workflows (Centralized Error Catching)

Every workflow must designate a single Error Trigger workflow that fires on execution failure. n8n's Error Trigger node receives execution metadata (workflow ID, error message, node that failed, timestamp). The Error Handler workflow (#5 in our plan) IS this mechanism — it must be set as the error handler for workflows 1–4 in their settings.

- Configured per-workflow under "Workflow Settings → Error Workflow"
- Receives: `{{ $execution.id }}`, `{{ $workflow.id }}`, `{{ $node.name }}`, `{{ $json.error.message }}`
- Without this, failures are silent — no alert, no retry, no audit trail

### 2. Node-Level Retry with Exponential Backoff

All HTTP Request nodes calling external APIs (Claude, HeyGen, ElevenLabs, Blotato) must have retry configured:

- **Retry on Fail**: enabled on every outbound HTTP node
- **Max retries**: 3–5 (default caps at 5, delay caps at 5 seconds in UI)
- **For longer backoff**: implement via Loop + Wait node pattern (overrides the 5s cap)
- **Classify errors before retrying**: 5xx and network timeouts are retryable; 4xx (except 429) are not
- Rate limit 429 responses require backoff logic extracted from `Retry-After` headers

### 3. Idempotency Keys on All Write Operations

Any operation that creates records (Supabase inserts, API calls that trigger external jobs) must be guarded by an idempotency key derived from stable business identifiers:

- Content pieces: `idempotency_key = hash(topic_id + content_type + brand_id)`
- Media jobs: `idempotency_key = hash(content_piece_id + asset_type)`
- Before insert: query for existing record with that key; skip or return existing if found
- Supabase: use `ON CONFLICT DO NOTHING` or `ON CONFLICT DO UPDATE` with upsert
- Without idempotency, workflow retries create duplicate DB records, duplicate HeyGen jobs, duplicate social posts

### 4. Workflow Locks for Singleton Cron Executions

Cron-triggered workflows (Status Monitor, Publishing) must guard against overlapping executions:

- Use Supabase `workflow_locks` table (already in schema) — insert lock row at start, delete at end
- Check for existing lock at workflow entry: if lock held and not expired, exit immediately
- Lock expiry: set TTL slightly longer than max expected execution time (e.g., 10 min for status poller)
- Alternative for smaller setups: Redis key with TTL via n8n's Redis node
- Without locks, two cron executions fire simultaneously and double-post or double-update records

### 5. Dedicated Error Workflow per Domain (Not One Global Catch-All)

Do not attach the same error handler to every workflow. Categorize:

- Content Generation errors: notify Slack/email, mark `topic.status = 'failed'`, stop
- Media Production errors: log which asset failed, mark that asset failed, allow other assets to continue
- Publishing errors: mark that platform publish as failed, do not retry the entire multi-platform job
- The Error Handler workflow (#5) is the central processor, but it must route by workflow ID/type to apply correct remediation

### 6. Execution History Retention and Pruning

n8n stores all execution logs in Postgres. Without pruning, the DB bloats and query performance degrades:

- Set `EXECUTIONS_DATA_PRUNE_MAX_COUNT` or time-based pruning via environment variables
- Recommended: retain 500–1000 executions per workflow, prune anything older than 30 days
- For audit purposes: push key execution events to a separate `pipeline_logs` Supabase table before pruning
- Keep failed executions longer (90 days) than successful ones (7–14 days)

### 7. HMAC-Signed Webhooks with Shared Secret Validation

All inbound webhooks (from Next.js → n8n) must validate HMAC-SHA256 signatures:

- Already implemented in the Supabase Edge Functions as callbacks; apply the same pattern to n8n webhook triggers
- n8n Webhook node: add a Code node immediately after that validates `X-Signature-256` header
- Reject and return 401 if signature mismatch — prevents unauthorized workflow triggering
- Rotate secrets via n8n credentials store, not hardcoded in nodes

### 8. Structured Logging to Supabase

n8n's internal execution logs are not queryable from the application. For operational visibility, emit structured log events to Supabase:

- At workflow start: insert row into `pipeline_runs` with `workflow_name`, `trigger_payload`, `started_at`
- At each major step: upsert `step_name`, `status`, `duration_ms`
- At workflow end: update `completed_at`, `final_status`, `output_summary`
- This enables the app dashboard to show pipeline status without calling n8n's API

---

## Differentiators

Advanced patterns that provide meaningful value above the baseline, specifically for async media production and multi-platform publishing.

### 1. Wait Node + Resume Webhook for Long-Running Async Jobs

HeyGen video generation and ElevenLabs TTS take 30 seconds to 10+ minutes. Do not poll in a tight loop inside a single execution — use n8n's Wait node with webhook resume:

**Pattern:**
```
HTTP POST to HeyGen (submit job)
  → extract job_id
  → store job_id + $execution.resumeUrl in DB
  → Wait node (mode: "On webhook call", timeout: 30 min)
  → [execution sleeps, frees resources]
  → [Status Monitor cron calls resumeUrl when job completes]
  → workflow resumes with completed asset data
```

- `$execution.resumeUrl` is a unique URL that resumes exactly this paused execution
- Store it in `content_pieces` or `visual_assets` alongside the external job ID
- Status Monitor workflow polls external APIs and calls the stored resumeUrl on completion
- This is the correct pattern for HeyGen and any other async media API

**Key limitation**: The resumeUrl changes if the execution runs partially first — always capture it in the same execution as the Wait node.

### 2. Fan-Out / Fan-In Parallel Asset Generation

Media Production workflow (#2) needs to generate multiple independent assets (TTS, avatar video, thumbnail, carousel, podcast music) simultaneously. Sequential processing is too slow.

**Pattern (Asynchronous Fan-Out):**
```
Trigger received
  → Split into N asset tasks (SplitInBatches or static branches)
  → Execute N sub-workflows in parallel (Execute Workflow node, do not wait for completion)
  → Each sub-workflow posts back to a "completion webhook" with asset_type + result
  → Aggregator node or DB polling waits until all N assets are marked complete
  → Continue to publishing phase
```

- Native n8n parallel execution: items from a split are processed concurrently within the same workflow
- True parallel sub-workflows: use Execute Workflow with "Do Not Wait for Sub-Workflow" (fire-and-forget), then poll DB for completion
- Do NOT use "Wait for Sub-Workflow" for long-running media tasks — it blocks the parent execution and burns concurrent execution slots

### 3. Dynamic Branching by Content Type / Platform

Publishing workflow (#4) must route differently based on content type (video vs. carousel vs. podcast) and target platform. Use the Switch node for deterministic routing, not nested If nodes:

```
Switch on content_piece.type:
  case "avatar_video"   → Blotato video publish path
  case "carousel"       → Blotato carousel path + thumbnail
  case "podcast"        → RSS feed update + Anchor/Spotify submit
  case "short_video"    → TikTok + Reels path
  default               → log unhandled type, alert
```

- Switch node handles up to 25 output branches cleanly
- Each branch should be a sub-workflow call, not 40+ additional nodes inline
- Platform-specific formatting (caption length limits, hashtag rules) lives inside the branch sub-workflow

### 4. Circuit Breaker Pattern for External APIs

If HeyGen or Blotato is degraded, the Status Monitor should stop hammering it after N consecutive failures rather than retrying at full cadence:

**Pattern:**
```
Track consecutive_failures in Supabase (or Redis counter)
  → If failures < threshold (e.g., 3): retry normally
  → If failures >= threshold: enter "open circuit" state
    → Skip API calls for N minutes (cooldown window)
    → Alert on first circuit open event
    → After cooldown: attempt single probe request
    → If probe succeeds: reset counter, resume normal operation
```

- Prevents cascading rate-limit violations
- Reduces alert noise during known API outages
- n8n has no native circuit breaker; implement via DB flag checked at workflow entry

### 5. Webhook Chaining with Typed Payloads

Chain workflows using typed webhook payloads rather than database polling to hand off between phases:

```
Workflow 1 (Content Generation) completes
  → HTTP POST to Workflow 2 webhook with: { content_piece_id, brand_id, processing_path }
  → Workflow 2 validates payload, starts media production
  → Workflow 2 completes
  → HTTP POST to Workflow 4 webhook with: { content_piece_id, asset_ids[], target_platforms[] }
```

- Each webhook payload must be minimal and typed — pass IDs, not full data blobs
- The receiving workflow fetches full data from Supabase using those IDs
- This keeps execution payloads small and avoids n8n's data size limits (4MB per node output)

### 6. Dead Letter Queue for Unrecoverable Failures

When a workflow exhausts all retries and cannot recover, the payload must not be silently dropped:

**Pattern:**
```
Error Handler workflow receives failure
  → Classify error (retryable vs. permanent)
  → If permanent: insert into `pipeline_dlq` table:
      { workflow_id, execution_id, original_payload, error_message, failed_at, retry_count }
  → Alert Slack/email with DLQ entry ID
  → Expose DLQ entries in app admin UI for manual replay
```

- DLQ is a Supabase table, not a Redis queue (more durable, queryable, auditable)
- Manual replay: admin clicks "retry" → app calls n8n webhook with original payload + DLQ entry ID
- n8n workflow checks for DLQ ID, skips idempotency guard only when replaying from DLQ with explicit intent

### 7. Execution Context Propagation (Correlation IDs)

Every workflow execution related to a single content piece should share a `correlation_id` (the `content_piece_id` or a UUID generated at topic ingestion):

- Pass `correlation_id` in every webhook payload and every Supabase log write
- Enables tracing a single piece of content across all 5 workflows in Supabase logs
- Useful for debugging: "why did this video never get published?" → query `pipeline_runs WHERE correlation_id = ?`

---

## Anti-Features

Things to deliberately NOT build — patterns that look reasonable but cause production pain.

### 1. Tight Polling Loops Inside a Single Execution

Anti-pattern:
```
Submit HeyGen job
  → Loop:
      → Wait 10 seconds
      → GET /video/{id}/status
      → If not complete: loop again (up to 30 iterations)
```

Why it fails:
- Holds a concurrent execution slot for the entire wait duration (5–10 minutes)
- With 5 parallel media productions, all concurrent slots consumed by waiting
- n8n's concurrency limit (default: varies) becomes the bottleneck, not API rate limits
- Use the Wait node + resume webhook pattern instead (see Differentiators #1)

### 2. Monolithic Workflows Exceeding 15–20 Nodes

Anti-pattern: building all 5 workflow responsibilities into one 60-node workflow.

Why it fails:
- Debugging requires scrolling through the entire canvas to find the failure point
- A failure in publishing breaks content generation for the same execution
- Cannot independently scale or retry one phase without re-running everything
- n8n loads the entire workflow into memory on every trigger, even when only one path executes
- Rule: if a workflow exceeds 15 nodes, extract cohesive sections into sub-workflows

### 3. Multiple Unrelated Webhooks in a Single Workflow

Anti-pattern: one workflow with a Webhook node for `/generate`, another Webhook node for `/publish`, and another for `/status` — all in the same workflow graph.

Why it fails (from n8n community, confirmed in docs):
- Every incoming request to ANY of those webhooks loads the entire workflow into memory
- A GET to `/status` loads publishing logic unnecessarily
- Debugging is confused by multiple entry points
- Correct approach: one webhook per workflow; related webhooks live in related but separate workflows

### 4. Storing Large Binary Data in n8n Execution Context

Anti-pattern: fetching a video file from HeyGen and passing it through n8n nodes to upload to Google Drive.

Why it fails:
- n8n node outputs have a ~4MB soft limit; large binary payloads cause silent truncation or OOM crashes
- Binary data in execution history bloats the Postgres DB rapidly
- Correct approach: HeyGen delivers the file to a URL; pass the URL, not the file; n8n tells Google Drive to fetch from that URL directly (server-to-server)

### 5. Using Cron Polling When a Webhook Exists

Anti-pattern: a 1-minute cron that queries "are there any content_pieces in status='pending'?" when the content generation workflow could directly trigger media production via webhook.

Why it fails:
- Adds 0–60 seconds of latency per content piece
- Every cron tick consumes an execution slot even when there's nothing to process
- Accumulates wasted DB queries at scale
- Use direct webhook chaining (Differentiators #5) between workflows whenever both endpoints are under your control

### 6. Per-Node Error Handling with Stop-and-Error on Every Node

Anti-pattern: adding an "On Error: Stop Workflow" + custom error message to every single node in a workflow.

Why it fails:
- Each node's error handling is subtly different, leading to inconsistent behavior
- Hard to maintain as the workflow grows
- Correct approach: let nodes fail naturally (propagate), catch at the workflow level via Error Trigger, handle consistently in Error Handler workflow (#5)
- Only add node-level error handling for nodes where a failure is expected and should be silently handled (e.g., "if no rows found, continue")

### 7. Hardcoding API Credentials in Code Nodes

Anti-pattern: `const apiKey = "sk-ant-api03-..."` inside a JavaScript Code node.

Why it fails:
- Credentials visible in n8n execution history (stored in DB)
- Cannot rotate without editing the node
- Violates least-privilege — anyone with n8n UI access sees the key
- Use n8n's Credentials store for all secrets; reference via node credential selector

### 8. Calling Sub-Workflows Synchronously for Long-Running Tasks

Anti-pattern: using "Execute Workflow" in wait mode (the default) for sub-workflows that take >30 seconds.

Why it fails:
- Parent execution is blocked and holds a concurrency slot for the entire duration
- If the sub-workflow times out, the parent fails too
- Use fire-and-forget (do not wait) + DB state + polling or webhook resume instead

---

## Production Patterns

How mature n8n deployments handle real-world operational concerns.

### Partial Failure Recovery

**Pattern — Checkpoint-Based Progress:**

Media Production (#2) must handle partial success (TTS done, HeyGen failed). Implement by tracking asset-level status independently:

```
visual_assets table:
  id, content_piece_id, asset_type, status, external_job_id, resume_url, retry_count, error_message
```

- Workflow reads the asset record at start; if `status = 'complete'`, skip that asset
- If `status = 'failed'` and `retry_count < max_retries`, re-attempt that asset only
- This allows the workflow to be re-triggered and pick up exactly where it left off
- A "resume" button in the admin UI re-triggers media production with the same `content_piece_id`; the workflow skips completed assets automatically

### Idempotency Implementation

Three-layer idempotency for content pipelines:

1. **DB layer**: Supabase unique constraint on `(topic_id, content_type)` for content_pieces; `ON CONFLICT DO UPDATE SET updated_at = NOW()` for upserts
2. **External API layer**: Use idempotency headers where supported (e.g., `Idempotency-Key: {content_piece_id}-{asset_type}` for ElevenLabs); store the key with the asset record
3. **Workflow layer**: Check `external_job_id IS NOT NULL` before submitting a new job to HeyGen/ElevenLabs — if already submitted, skip submission and go straight to polling

### Execution History and Observability

n8n's built-in execution history is for debugging, not operational reporting. Supplement with:

| Concern | Tool | Implementation |
|---------|------|----------------|
| Workflow run audit | Supabase `pipeline_runs` | Write at start/end of each workflow |
| Step-level timing | Supabase `pipeline_steps` | Write per major node group |
| Error aggregation | Supabase `pipeline_errors` | Write in Error Handler, join with DLQ |
| Business metrics | Supabase `cost_tracking` | Write API call costs alongside results |
| Alerting | Slack webhook | Error Handler posts to #alerts channel |
| Uptime monitoring | n8n `/healthz` endpoint | External ping from UptimeRobot or similar |

n8n's built-in metrics endpoint (`/metrics`) exposes Prometheus-format data: active executions, queue depth, error rates. Wire this to Grafana if you have it; if not, the Supabase approach above is sufficient for this scale.

**Execution pruning env vars (set in n8n docker-compose):**
```
EXECUTIONS_DATA_PRUNE=true
EXECUTIONS_DATA_MAX_AGE=168        # 7 days for successful runs (hours)
EXECUTIONS_DATA_PRUNE_MAX_COUNT=500
```

Keep failed executions indefinitely in n8n (for debugging) until the issue is resolved, then prune manually.

### Concurrency and Scaling

For self-hosted n8n at this content volume (daily automated runs, not high-frequency):

- **Single-instance mode** (no Redis queue) is sufficient for <50 concurrent executions
- Set `N8N_CONCURRENCY_PRODUCTION_LIMIT=10` to prevent runaway cron stacking
- **When to upgrade to queue mode**: if Media Production workflow runs for >10 pieces simultaneously and you need guaranteed delivery — queue mode with Redis adds durability but significant operational complexity
- For content pipelines running once per day per piece, single-instance with DB-level workflow locks is the right tradeoff

### Monitoring and Alerting

Minimum viable monitoring setup for production:

1. **Error Handler → Slack**: every workflow failure posts to a Slack channel with workflow name, error message, correlation_id, and a link to the n8n execution
2. **Daily summary cron**: a 6th lightweight workflow runs at 6PM, queries Supabase for the day's `pipeline_runs`, and posts a summary (X content pieces processed, Y failed, Z in DLQ) to Slack
3. **n8n health check**: external ping to `https://n8n.yourdomain.com/healthz` every 5 minutes; alert if non-200
4. **DLQ alert**: any insert to `pipeline_dlq` table triggers a Supabase Database Webhook → n8n → Slack alert immediately

### Retry Budget and Backoff Schedule

Standard retry schedule for media API calls (overrides n8n's 5s max via Loop + Wait):

| Attempt | Delay | Total elapsed |
|---------|-------|---------------|
| 1st retry | 5s | 5s |
| 2nd retry | 15s | 20s |
| 3rd retry | 60s | 80s |
| 4th retry | 300s (5m) | 6m 20s |
| 5th retry | 900s (15m) | 21m 20s |
| Give up → DLQ | — | — |

Add ±20% random jitter to each delay to avoid thundering herd when multiple jobs fail simultaneously (e.g., after HeyGen outage clears).

### Deployment and Environment Separation

- Maintain separate n8n credentials per environment (dev/prod) using n8n's environments feature or separate instances
- Use n8n's tagging feature to group workflows: tag all 5 FHContent workflows with "fhcontent-v2"
- Export workflow JSON to git on every change (manual or via n8n API): `GET /api/v1/workflows/{id}` → commit to repo
- Never edit production workflows directly — export, edit JSON, import, test in dev, promote

---

## Feature Dependencies

Which features depend on other features being in place first. Build in this order.

```
Level 0 (No dependencies — build first):
  - HMAC webhook validation (all inbound webhooks)
  - Idempotency keys + DB unique constraints
  - Supabase pipeline_runs / pipeline_steps / pipeline_errors tables
  - n8n credentials store setup (Claude, HeyGen, ElevenLabs, Blotato keys)
  - workflow_locks table + lock/unlock helper sub-workflow

Level 1 (Depends on Level 0):
  - Error Handler workflow (#5) — must exist before any other workflow can designate it
  - Structured Supabase logging — depends on tables from Level 0
  - Correlation ID propagation — depends on logging tables

Level 2 (Depends on Level 1):
  - Content Generation workflow (#1) — depends on Error Handler, logging, idempotency
  - Dead Letter Queue — depends on Error Handler to route to it

Level 3 (Depends on Level 2):
  - Media Production workflow (#2) — triggered by Content Generation webhook; depends on DLQ, Wait node pattern, asset-level status tracking
  - Status Monitor workflow (#3) — depends on asset records created by Media Production; depends on workflow locks

Level 4 (Depends on Level 3):
  - Publishing workflow (#4) — depends on assets being in 'ready' status; depends on Status Monitor marking them complete
  - Circuit breaker — depends on Status Monitor tracking consecutive failures

Level 5 (Depends on all):
  - Daily summary cron workflow
  - Admin UI DLQ replay
  - Grafana/Prometheus observability (optional enhancement)
```

**Critical path for MVP**: Level 0 → Error Handler → Content Generation → Media Production → Status Monitor → Publishing. The DLQ, circuit breaker, and daily summary can be added in a second pass without disrupting the core pipeline.

---

## Sources

- [Error handling | n8n Docs](https://docs.n8n.io/flow-logic/error-handling/)
- [Advanced n8n Error Handling and Recovery Strategies](https://www.wednesday.is/writing-articles/advanced-n8n-error-handling-and-recovery-strategies)
- [n8n Orchestration with Retries: Idempotent Workflows That Heal Themselves](https://medium.com/@komalbaparmar007/n8n-orchestration-with-retries-idempotent-workflows-that-heal-themselves-f47b4e467ed4)
- [n8n Backfills with Idempotency Keys: Recover Pipelines Without Duplicates](https://medium.com/@kaushalsinh73/n8n-backfills-with-idempotency-keys-recover-pipelines-without-duplicates-d0be7aaddaa7)
- [Building Reliable Job Queue Integrations with n8n: Webhook Callbacks, Idempotency & Error Recovery](https://www.codesmith.in/post/n8n-job-queue-webhook-callbacks)
- [15 best practices for deploying AI agents in production — n8n Blog](https://blog.n8n.io/best-practices-for-deploying-ai-agents-in-production/)
- [Handle Partial Workflow Failures in n8n: 4 Steps](https://flowgenius.in/n8n-partial-failure-handling/)
- [Pattern for parallel sub-workflow execution followed by wait-for-all loop](https://n8n.io/workflows/2536-pattern-for-parallel-sub-workflow-execution-followed-by-wait-for-all-loop/)
- [Run multiple tasks in parallel with asynchronous processing and webhooks](https://n8n.io/workflows/8578-run-multiple-tasks-in-parallel-with-asynchronous-processing-and-webhooks/)
- [Wait | n8n Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/)
- [Waiting | n8n Docs](https://docs.n8n.io/flow-logic/waiting/)
- [Safer n8n Sub-workflows With The V2.0 Wait Node Fix](https://blog.nocodecreative.io/n8n-v2-wait-node-hitl-sub-workflows/)
- [Why You Shouldn't Cram Multiple Webhooks Into One n8n Workflow](https://www.piotr-sikora.com/blog/2026-01-10-n8n-architecture-why-multiple-webhooks-in-one-workflow-is-bad-idea)
- [5 Critical Mistakes to Avoid When Building N8N Workflows](https://michaelitoback.com/building-n8n-workflows/)
- [Concurrency control | n8n Docs](https://docs.n8n.io/hosting/scaling/concurrency-control/)
- [Redis locking for concurrent task handling | n8n workflow template](https://n8n.io/workflows/3444-redis-locking-for-concurrent-task-handling/)
- [Configuring queue mode | n8n Docs](https://docs.n8n.io/hosting/scaling/queue-mode/)
- [Logging | n8n Docs](https://docs.n8n.io/hosting/logging-monitoring/logging/)
- [Monitoring | n8n Docs](https://docs.n8n.io/hosting/logging-monitoring/monitoring/)
- [n8n Monitoring and Alerting Setup for Production Environments](https://www.wednesday.is/writing-articles/n8n-monitoring-and-alerting-setup-for-production-environments)
- [n8n Dead-Letter Queues Done Right: Replayable, Idempotent Recovery at Scale](https://medium.com/@kaushalsinh73/n8n-dead-letter-queues-done-right-replayable-idempotent-recovery-at-scale-70686f2d15d6)
- [n8n Error Handling Patterns: Retry, Dead Letter, Circuit Breaker](https://www.pagelines.com/blog/n8n-error-handling-patterns)
- [Auto-retry engine: error recovery workflow | n8n workflow template](https://n8n.io/workflows/3144-auto-retry-engine-error-recovery-workflow/)
- [Generate & auto-post tech news AI avatar videos to social media with Heygen and Blotato](https://n8n.io/workflows/8308-generate-and-auto-post-tech-news-ai-avatar-videos-to-social-media-with-heygen-and-blotato/)
- [Seven N8N Workflow Best Practices for 2026](https://michaelitoback.com/n8n-workflow-best-practices/)
- [The beginner's guide to webhooks for workflow automation — n8n Blog](https://blog.n8n.io/webhooks-for-workflow-automation/)
- [N8N + Webhooks: Build Event-Driven Automations That Replace Your Cron Jobs](https://blog.elest.io/n8n-webhooks-build-event-driven-automations-that-replace-your-cron-jobs/)
- [The n8n Scaling & Reliability Guide](https://medium.com/@orami98/the-n8n-scaling-reliability-guide-queue-mode-topologies-error-handling-at-scale-and-production-9f33b13d2be8)
