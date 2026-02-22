# Roadmap: Content Command Center — n8n Orchestration

## Overview

This milestone replaces three opaque Vercel cron jobs with a self-hosted n8n instance that makes every pipeline step visible, retryable, and debuggable. The build order is strictly dependency-driven: infrastructure first, error handling second, security third, then workflows built leaf-to-orchestrator so each can be verified in parallel with the existing Vercel crons before cutover. When Phase 6 completes, the dashboard "Generate" button fires n8n, all three Vercel crons are disabled, and every failure produces an observable alert rather than a silent timeout.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Infrastructure Foundation** - n8n 2.9.0 running on Docker/WSL2 with PostgreSQL, Cloudflare Tunnel, WinSW autostart, all credentials stored, execution pruning configured
- [ ] **Phase 2: Error Infrastructure** - WF-Error global handler active, canary heartbeat monitoring, pipeline_errors and pipeline_runs tables wired up
- [ ] **Phase 3: Webhook Security and Supabase Integration** - HMAC-SHA256 signing proven end-to-end against all 4 existing Edge Functions
- [ ] **Phase 4: Leaf Workflows** - WF-5 (Status Poller) and WF-3 (Research Sub-Workflow) built, verified, and WF-5 replacing check-status Vercel cron
- [ ] **Phase 5: Worker Workflows** - WF-4 (Publish Pipeline) and WF-2 (Media Pipeline) built, verified, and both Vercel crons replaced
- [ ] **Phase 6: Orchestrator and Cutover** - WF-1 (Topic Pipeline) complete, dashboard button wired to n8n, all three Vercel crons removed

## Phase Details

### Phase 1: Infrastructure Foundation
**Goal**: A production-grade n8n instance is running and ready to receive workflows — PostgreSQL database, Cloudflare Tunnel, WinSW autostart, all API credentials stored, and Windows configured to prevent sleep killing executions.
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, INFRA-08, SEC-01, SEC-04
**Research flag**: No — Docker/WSL2/PostgreSQL setup is exhaustively documented; STACK.md docker-compose config is ready to use.
**Success Criteria** (what must be TRUE):
  1. `docker compose up -d` starts n8n 2.9.0 and PostgreSQL 15; `n8n --version` in the container confirms version is above 2.5.2 (CVE-2026-21858 threshold)
  2. n8n UI is reachable at localhost:5678 after a full Windows reboot without manual intervention (WinSW service active, no sleep interruption)
  3. Cloudflare Tunnel is active and the public webhook URL returns a valid n8n response; port 5678 is not directly reachable from outside the machine
  4. All 9 API credentials (Claude, HeyGen, Blotato, ElevenLabs, Gemini, OpenAI, Canva, Supabase service key, Supabase anon key) appear in the n8n credential store and pass their built-in connection tests
  5. Schedule Triggers fire at correct Eastern Time (America/New_York) — confirmed by a test workflow writing a timestamp to Supabase and comparing against wall clock
**Plans**: 4 plans

Plans:
- [ ] 01-01: Docker Compose setup — WSL2 backend, PostgreSQL 15 service, n8n 2.9.0 pinned image, environment variables (N8N_ENCRYPTION_KEY, TZ, GENERIC_TIMEZONE, EXECUTIONS_DATA_PRUNE, EXECUTIONS_DATA_MAX_AGE)
- [ ] 01-02: Cloudflare Tunnel and network hardening — tunnel creation, WEBHOOK_URL env var, confirm port 5678 not externally exposed
- [ ] 01-03: WinSW service wrapper and Windows power configuration — WinSW autostart, High Performance power plan, sleep/hibernate disabled
- [ ] 01-04: Credential store population and timezone validation — all 9 credentials entered and tested, canary test workflow confirms Eastern Time scheduling

### Phase 2: Error Infrastructure
**Goal**: Every workflow failure produces an observable, queryable alert before any production workflow is activated — the Error Handler workflow is the global catch-all, canary heartbeat proves triggers are firing after reboots, and both Supabase tables exist for logging.
**Depends on**: Phase 1
**Requirements**: ERR-01, ERR-02, ERR-03, MON-01, MON-02
**Research flag**: No — Error Trigger workflow is a well-documented n8n primitive; Slack webhook integration is straightforward.
**Success Criteria** (what must be TRUE):
  1. WF-Error is designated as the global error workflow in n8n settings; a deliberately broken test workflow triggers WF-Error and produces a Slack message containing workflow name, node name, error message, and timestamp
  2. A failing test workflow's error is inserted into the `pipeline_errors` Supabase table with correct fields (workflow_name, node_name, error_message, occurred_at) and is queryable from the dashboard
  3. Canary heartbeat workflow writes a timestamp to Supabase `pipeline_runs` every 1 minute; absence of a fresh row within 2 minutes is detectable by querying that table from outside n8n
  4. `pipeline_runs` table exists in Supabase and accepts inserts from n8n with correct schema (execution_id, workflow_name, status, started_at, completed_at, correlation_id)
**Plans**: 3 plans

Plans:
- [ ] 02-01: Supabase table creation — `pipeline_errors` and `pipeline_runs` DDL, confirm RLS policies allow n8n service key inserts
- [ ] 02-02: WF-Error global handler — Error Trigger node, Slack webhook alert node, Supabase insert to `pipeline_errors`, set as global error workflow in n8n settings, end-to-end test with broken workflow
- [ ] 02-03: Canary heartbeat workflow — 1-minute Schedule Trigger, Supabase insert to `pipeline_runs`, confirm row freshness is monitorable externally

### Phase 3: Webhook Security and Supabase Integration
**Goal**: n8n can sign outbound requests with HMAC-SHA256 and the existing Supabase Edge Functions accept those requests — the full n8n-to-Edge-Function round-trip is proven before any real data flows through it.
**Depends on**: Phase 2
**Requirements**: SEC-02, SEC-03, INT-02
**Research flag**: Yes — the raw body vs. parsed body issue (RP-3 in SUMMARY.md) makes `$request.body` buffer access in n8n 2.9.0 Code nodes a validation risk. Confirm the exact API before building all 4 HMAC validation nodes on it.
**Success Criteria** (what must be TRUE):
  1. A test HTTP Request node in n8n sends a POST to `n8n-topic-callback` Edge Function with a valid `X-N8N-Signature` header and receives a 200 response (not 401); the same request with a tampered body receives a 401
  2. The same HMAC signing Code node pattern is validated against all 4 Edge Functions (topic, research, asset, publish callbacks) — each returns 200 for a signed test payload
  3. `N8N_WEBHOOK_SECRET` in the n8n `.env` matches the secret configured in the Supabase Edge Function environment; changing either side to a mismatched value produces a 401 on the next test call
**Plans**: 3 plans

Plans:
- [ ] 03-01: HMAC signing Code node — implement `X-N8N-Signature` header generation using `N8N_WEBHOOK_SECRET`, validate raw body handling in n8n 2.9.0 runtime (spike before building production nodes)
- [ ] 03-02: End-to-end validation against all 4 Edge Functions — test signed payloads against n8n-topic-callback, n8n-research-callback, n8n-asset-callback, n8n-publish-callback; confirm 200/401 behavior
- [ ] 03-03: Secret rotation procedure — document how to rotate `N8N_WEBHOOK_SECRET` across n8n env and Supabase without downtime; confirm SEC-04 (port isolation) and SEC-05 (CRON_SECRET header still checked during transition) are in place

### Phase 4: Leaf Workflows
**Goal**: WF-5 (Status Poller) and WF-3 (Research Sub-Workflow) are built, verified against live data, and WF-5 is replacing the `check-status` Vercel cron — the first production cutover confirms the full n8n-to-Next.js-to-Edge-Function integration chain works under real conditions.
**Depends on**: Phase 3
**Requirements**: WF-03, WF-05, WF-06, INT-01, INT-03, SEC-05, ERR-04, CUT-01, CUT-02
**Research flag**: No — WF-5 mirrors existing `check-status` cron logic exactly; business logic already exists in Next.js routes.
**Success Criteria** (what must be TRUE):
  1. WF-5 runs every 10 minutes and updates `content_pieces.video_url` and `visual_assets` for completed HeyGen/Blotato jobs via the `n8n-asset-callback` Edge Function — results match what the Vercel `check-status` cron would have written for the same jobs
  2. WF-5 acquires the `workflow_locks` table lock before execution and releases it on completion; a concurrent manual trigger while a run is active is rejected by the lock check
  3. WF-3 executes a web research query for a known topic_id and posts results to the `n8n-research-callback` Edge Function; the topics table reflects the merged research sources
  4. All n8n HTTP Request nodes in WF-5 and WF-3 use the Loop + Wait retry pattern with exponential backoff — a simulated 429 from the Next.js route causes a retry after delay rather than an immediate failure
  5. All nodes in WF-5 and WF-3 carry the topic_id or content_piece_id as a correlation ID visible in n8n execution logs
  6. After 48 hours of WF-5 results matching the Vercel `check-status` cron output, the `check-status` Vercel cron entry is removed from `vercel.json`
**Plans**: 4 plans

Plans:
- [ ] 04-01: WF-5 Status Poller — 10-minute Schedule Trigger, `workflow_locks` acquisition, HeyGen/Blotato status poll via Next.js route, `n8n-asset-callback` write-back, correlation ID on all nodes
- [ ] 04-02: WF-5 retry hardening — Loop + Wait exponential backoff on all HTTP Request nodes, ERR-04 compliance, test with simulated 429/500 responses
- [ ] 04-03: WF-3 Research Sub-Workflow — synchronous execution pattern, Perplexity/Tavily research nodes, `n8n-research-callback` write-back, correlation ID propagation, SEC-05 CRON_SECRET header on any Next.js route calls
- [ ] 04-04: WF-5 cutover — 48h parallel run verification, match results against Vercel cron, remove `check-status` from `vercel.json`, confirm WF-5 is the sole operator of that logic

### Phase 5: Worker Workflows
**Goal**: WF-4 (Publish Pipeline) and WF-2 (Media Pipeline) are built and verified, replacing the two remaining Vercel crons — WF-2's 6-branch parallel fan-out is the most complex workflow in the system and must be spike-tested for concurrency limit behavior before production.
**Depends on**: Phase 4
**Requirements**: WF-02, WF-04, ERR-05, CUT-03, CUT-04
**Research flag**: Yes — WF-2's 6-branch parallel fan-out may hit `N8N_CONCURRENCY_PRODUCTION_LIMIT`; spike workflow needed to confirm whether all 6 branches execute simultaneously or require batching before full implementation.
**Success Criteria** (what must be TRUE):
  1. WF-4 runs on the hourly cron and on manual webhook trigger, calls `/api/cron/daily-publish`, and posts confirmation to `n8n-publish-callback` for each successfully published platform — Supabase `content_pieces` status and `published_log` reflect the results
  2. WF-2 runs at 6AM cron and on webhook trigger, launches all 6 asset generation branches (HeyGen long-form, Blotato shorts x4, thumbnail, carousel, podcast, music) without concurrency errors — branches that fail are captured in the Dead Letter Queue (`pipeline_dlq` table) rather than silently dropped
  3. `pipeline_dlq` Supabase table exists and receives inserts for any WF-2 or WF-4 failure that exhausts all retries — each DLQ row contains enough information to manually replay the failed operation
  4. After 48 hours of WF-4 results matching the Vercel `daily-publish` cron output, that cron is removed from `vercel.json`
  5. After 48 hours of WF-2 results matching the Vercel `daily-media` cron output, that cron is removed from `vercel.json`
**Plans**: 5 plans

Plans:
- [ ] 05-01: `pipeline_dlq` table DDL — Supabase migration for Dead Letter Queue table with fields for workflow_name, correlation_id, payload, error, failed_at, retry_count
- [ ] 05-02: WF-4 Publish Pipeline — hourly cron + webhook trigger, `workflow_locks` acquisition, `/api/cron/daily-publish` call, `n8n-publish-callback` write-back per platform, DLQ insert on unrecoverable failure
- [ ] 05-03: WF-2 concurrency spike — test workflow with 6 parallel branches to confirm `N8N_CONCURRENCY_PRODUCTION_LIMIT` behavior; document whether batching is required and adjust implementation plan
- [ ] 05-04: WF-2 Media Pipeline — 6AM cron + webhook trigger, `workflow_locks` acquisition, 6-branch parallel fan-out per topic, `n8n-asset-callback` write-back per branch, DLQ insert on branch failure
- [ ] 05-05: Worker cron cutover — 48h parallel runs for both WF-4 and WF-2, validate results match Vercel crons, remove `daily-publish` and `daily-media` from `vercel.json`

### Phase 6: Orchestrator and Cutover
**Goal**: WF-1 (Topic Pipeline) completes the dependency graph — the dashboard "Generate" button fires n8n, WF-1 calls WF-3 synchronously and WF-2 asynchronously, and all three Vercel crons are permanently disabled after verified stable operation.
**Depends on**: Phase 5
**Requirements**: WF-01, INT-04, INT-05, MON-03, CUT-05
**Research flag**: No — WF-1 uses Execute Sub-Workflow (documented primitive) for WF-3 and webhook fire-and-forget for WF-2; the pattern is well-established.
**Success Criteria** (what must be TRUE):
  1. Clicking "Generate and Schedule" on the dashboard fires the n8n WF-1 webhook; the dashboard receives a confirmation response within 5 seconds and the topic status in Supabase transitions to `research_pending`
  2. WF-1 calls WF-3 as a synchronous sub-workflow (Execute Sub-Workflow node, wait = ON) — WF-1 does not proceed to content generation until WF-3 posts research results to the `n8n-research-callback` Edge Function and Supabase confirms the merge
  3. WF-1 fires WF-2 via fire-and-forget webhook after research completes — WF-1 execution finishes without waiting for media generation; WF-2 begins independently
  4. All 5 workflows and WF-Error share the topic_id correlation ID in their n8n execution logs — a failed execution in any workflow can be traced back to its originating topic_id in `pipeline_runs` and `pipeline_errors`
  5. `vercel.json` contains zero cron entries; the three Vercel cron routes (`/api/cron/daily-media`, `/api/cron/daily-publish`, `/api/cron/check-status`) remain in the codebase but are no longer scheduled
**Plans**: 3 plans

Plans:
- [ ] 06-01: Dashboard webhook integration — update the dashboard "Generate" button to fire n8n WF-1 webhook URL instead of calling the Next.js route directly; confirm response contract
- [ ] 06-02: WF-1 Topic Pipeline — webhook trigger, `/api/topics/generate` call, Execute Sub-Workflow (WF-3 synchronous), webhook fire-and-forget (WF-2 async), `n8n-topic-callback` write-back, correlation ID propagation across all downstream workflows
- [ ] 06-03: Final cutover and verification — confirm zero Vercel cron entries, run full end-to-end test from dashboard button to published content, verify `pipeline_runs` captures all 5 workflow executions with correct correlation IDs, confirm `pipeline_errors` is the only source of truth for failures

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Infrastructure Foundation | 0/4 | Not started | - |
| 2. Error Infrastructure | 0/3 | Not started | - |
| 3. Webhook Security and Supabase Integration | 0/3 | Not started | - |
| 4. Leaf Workflows | 0/4 | Not started | - |
| 5. Worker Workflows | 0/5 | Not started | - |
| 6. Orchestrator and Cutover | 0/3 | Not started | - |
