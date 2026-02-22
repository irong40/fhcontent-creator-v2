# Project Research Summary

**Project:** FHContent Creator v2 — n8n Orchestration Layer
**Domain:** Self-hosted workflow orchestration for AI content pipelines
**Researched:** 2026-02-22
**Confidence:** HIGH

## Executive Summary

This project replaces 3 Vercel Cron jobs with a self-hosted n8n instance running on a local Windows machine. The research is unambiguous: n8n 2.9.0 via Docker Desktop with WSL2 backend is the only supported production path on Windows — direct npm install is broken by design on this platform. The architecture maps cleanly to 5 workflows (Topic Pipeline, Media Pipeline, Research Sub-Workflow, Publish Pipeline, Status Poller), built leaf-first with no dependency conflicts. The most important discovery from codebase analysis is that the integration layer already exists: 4 Supabase Edge Functions with shared HMAC-SHA256 validation (`n8n-topic-callback`, `n8n-research-callback`, `n8n-asset-callback`, `n8n-publish-callback`) are already deployed and waiting. n8n's only job is to call existing Next.js API routes and POST results back through those Edge Functions — no new backend logic is needed.

The biggest risks are operational, not architectural. Windows-specific pitfalls (trigger deactivation after restart, sleep/hibernate killing executions, PM2 unreliability) will kill a production pipeline if ignored. Security is also non-trivial: CVE-2026-21858 (CVSS 10.0) affects all n8n versions below 1.121.0, meaning version selection must be intentional and verified on day one. The correct minimum is 2.9.0, which is well above the patched threshold. The recommended pattern for async media APIs (HeyGen/Blotato) is the Scheduled Sweeper approach via WF-5, not the Wait node resume pattern, because n8n restarts on Windows would silently drop in-progress Wait executions.

The feature dependency order is well-defined: foundation infrastructure (PostgreSQL, HMAC, credentials, canary heartbeat) must precede Error Handler, which must precede all 5 workflows. The 5 workflows are built in reverse dependency order — Status Poller first (no deps, replaces check-status cron), Research Sub-Workflow second (no deps, new capability), Publish Pipeline third (replaces daily-publish cron), Media Pipeline fourth (most complex, depends on Status Poller), Topic Pipeline last (orchestrator, depends on Research Sub-Workflow). This build order lets each workflow be deployed and verified against live data independently before the next is added.

---

## Key Findings

### Recommended Stack

n8n 2.9.0 is the target version, pinned explicitly in `docker-compose.yml` as `docker.n8n.io/n8nio/n8n:2.9.0`. PostgreSQL 15 (Docker Compose service) is required — SQLite hits `SQLITE_BUSY` errors under the concurrent load this project generates. Webhook exposure to the public internet is via Cloudflare Tunnel (free, persistent), stored as `WEBHOOK_URL` in the n8n `.env`. The n8n Credential Store holds all API keys; the Docker `.env` holds only system config.

Two timezone environment variables are both mandatory and must match: `TZ=America/New_York` and `GENERIC_TIMEZONE=America/New_York`. One without the other causes Schedule Triggers to fire at the wrong time. The `N8N_ENCRYPTION_KEY` must be a fixed 64-character string set before first launch — auto-generated keys stored in `~/.n8n/config` will be lost on reinstall, permanently destroying all saved credentials.

**Core technologies:**
- n8n 2.9.0: Workflow orchestrator — Docker + WSL2 is the only reliable Windows production path
- PostgreSQL 15: n8n internal DB — SQLite is functionally broken above 2-3 concurrent workflows
- Cloudflare Tunnel: Public webhook exposure — free, persistent, required for Supabase Edge Function callbacks
- Docker Desktop + WSL2: Runtime container — eliminates Windows path separator and native module build failures
- Supabase Edge Functions (existing): Write-back layer — 4 callbacks already deployed with shared HMAC validation

**Key version constraints:**
- n8n minimum: 2.5.2 (security); target: 2.9.0 (latest stable)
- Pin image version in docker-compose — weekly releases have had breaking changes
- Do NOT expose n8n UI or port 5678 externally (SEC-1 attack surface)

### Expected Features

**Must have (table stakes):**
- Error Trigger workflow (WF-Error) configured as global error handler — without this, every failure is silent
- Workflow locks via existing `workflow_locks` Supabase table — prevents duplicate cron processing
- HMAC-SHA256 validation Code node on every inbound webhook — existing Edge Functions expect `X-N8N-Signature` header
- Idempotency keys on all Supabase write operations — retry safety requires `ON CONFLICT DO NOTHING` semantics
- Structured logging to Supabase `pipeline_runs` table — n8n execution logs are not queryable from the app
- Execution history pruning (`EXECUTIONS_DATA_PRUNE=true`, 7-day retention) — prevents DB bloat killing performance
- Canary heartbeat workflow — the only external signal that n8n triggers are actually firing after a Windows restart
- Node-level retry with exponential backoff (Loop + Wait pattern) — n8n's built-in 5-second retry cap is insufficient for media APIs

**Should have (competitive/operational):**
- Wait node + Scheduled Sweeper pattern for async HeyGen/Blotato jobs — replaces the existing `check-status` cron with identical logic in WF-5
- Fan-out parallel asset generation in WF-2 — thumbnail, carousel, podcast, music generated in parallel branches
- Dead Letter Queue (`pipeline_dlq` Supabase table) — unrecoverable failures stored for manual replay from admin UI
- Correlation ID propagation (`content_piece_id`) across all 5 workflows — enables cross-workflow debugging
- Circuit breaker pattern per external API — prevents rate-limit cascade during HeyGen/Blotato outages
- Daily summary cron (WF-6, lightweight) — posts pipeline health summary to Slack at 6PM

**Defer to v2+:**
- n8n queue mode with Redis — single-instance with DB-level locks is sufficient for this content volume
- Grafana/Prometheus observability — Supabase `pipeline_runs` tables cover the need at this scale
- Automated bidirectional GitHub sync — manual JSON export on change is sufficient for solo operation
- Admin UI DLQ replay button — the DLQ table itself is the priority; UI replay can follow
- Circuit breaker per-API (full implementation) — log consecutive failures in Phase 1, add circuit state in Phase 2

### Architecture Approach

n8n is the scheduler and fan-out layer only. It never calls external APIs (Claude, HeyGen, ElevenLabs, Blotato) directly. All business logic stays in Next.js API routes — n8n calls those routes and handles responses. Write-backs after async operations flow through the 4 existing Supabase Edge Functions. This preserves TypeScript type safety, Zod schema validation, and all existing service abstractions in the codebase. Supabase can be queried directly from n8n (via the Supabase node) for read-only lookups that do not need a Next.js round-trip.

**Major components:**
1. WF-1 (Topic Pipeline) — Webhook-triggered orchestrator: calls `/api/topics/generate`, executes WF-3 as synchronous sub-workflow, then fires WF-2 via fire-and-forget webhook
2. WF-2 (Media Pipeline) — Cron 6AM + webhook: 6-branch parallel fan-out per topic (HeyGen long-form, Blotato short-form x4, thumbnail, carousel, podcast, music)
3. WF-3 (Research Sub-Workflow) — Synchronous leaf: Perplexity/Tavily web research, posts to `n8n-research-callback` Edge Function
4. WF-4 (Publish Pipeline) — Cron hourly + webhook: calls `/api/cron/daily-publish`, posts to `n8n-publish-callback` for each confirmed platform
5. WF-5 (Status Poller) — Cron every 10 minutes: sweeper that polls HeyGen/Blotato for async job completion, writes via `n8n-asset-callback`
6. WF-Error (Error Handler) — Error Trigger: global catch-all, routes by workflow type to Slack alert and Supabase `pipeline_errors` insert

**Interconnection pattern summary:**
- WF-1 calls WF-3 synchronously (Execute Sub-Workflow, wait = ON) — research data needed before content generation
- WF-1 calls WF-2 asynchronously (webhook fire-and-forget) — media generation does not block topic completion
- WF-5 is stateless (reads DB, polls APIs, writes DB) — survives Windows restarts cleanly
- HeyGen callback via HeyGen's native callback is NOT used (basic API tier does not support configurable callbacks); WF-5 sweeper is the correct pattern

**Existing codebase integration points (already built, no changes needed):**
- `supabase/functions/n8n-topic-callback` — validates HMAC, writes `topics.status`
- `supabase/functions/n8n-research-callback` — validates HMAC, merges `topics.historical_points._research_sources`
- `supabase/functions/n8n-asset-callback` — validates HMAC, writes `content_pieces.video_url` + `visual_assets`
- `supabase/functions/n8n-publish-callback` — validates HMAC, writes `content_pieces` status + `published_log`
- `supabase/functions/_shared/hmac.ts` — shared HMAC-SHA256 validation with timing-safe comparison; header: `X-N8N-Signature`

### Critical Pitfalls

1. **Silent workflow failures (CM-1)** — n8n has zero alerting by default; create the Error Handler workflow and set it as the global error workflow before activating anything in production. Test it by deliberately breaking a node.

2. **Trigger deactivation after Windows restart (CM-2)** — workflows appear "Active" in the UI but never fire after reboot; implement a canary heartbeat workflow (1-minute Schedule Trigger writes timestamp to Supabase) and monitor `last_heartbeat` from outside n8n. Toggle workflows off/on post-restart as a startup script.

3. **SQLite concurrency failures (CM-3)** — even 5 workflows with a 10-minute check-status cron produces enough concurrent load to hit `SQLITE_BUSY`; configure PostgreSQL before writing a single workflow.

4. **HMAC validation on parsed body (RP-3)** — computing HMAC against `$json.body` (parsed) instead of raw bytes will cause every Supabase Edge Function callback to fail with 401; use `$request.body` raw buffer and test in isolation before wiring into production.

5. **CVE-2026-21858 (SEC-1, CVSS 10.0)** — affects n8n 1.65 through 1.120.4; starting at 2.9.0 is safe, but verify with `n8n --version` and subscribe to the n8n security advisory channel. Never expose port 5678 or webhook URLs without authentication.

6. **Windows sleep/hibernate kills executions (WS-4)** — set Windows power plan to High Performance before go-live; long-running executions are silently dropped as "crashed" with no recovery.

7. **Machine offline = webhook calls lost forever (RP-1)** — n8n does not queue missed webhooks; Edge Functions should write `callback_status = 'pending'` and WF-5 should poll for stale pending callbacks to requeue them.

---

## Implications for Roadmap

Based on the dependency graph from FEATURES.md, the build-first order from ARCHITECTURE.md, and the phase mapping from PITFALLS.md, the following phase structure is recommended.

### Phase 1: Infrastructure Foundation
**Rationale:** Every subsequent workflow and security control depends on this. PostgreSQL must exist before any workflow runs. Credentials must be stored before any node can authenticate. The canary heartbeat must exist before any production workflow can be trusted.
**Delivers:** Running n8n 2.9.0 on Docker/WSL2 with PostgreSQL, Cloudflare Tunnel, WinSW autostart, all API credentials stored, canary heartbeat active, execution pruning configured.
**Addresses:** CM-3 (PostgreSQL), SEC-1 (version verification), SEC-3 (encryption key), WS-1 (WinSW), WS-4 (sleep), WS-5 (WEBHOOK_URL), RP-4 (timezone), PS-4 (pruning)
**Avoids:** Starting workflow development on a broken foundation that will require teardown and restart.

### Phase 2: Error Infrastructure
**Rationale:** The Error Handler workflow (WF-Error) must exist and be designated as the global error workflow before any production workflow is activated. Activating workflows without error handling is the industry-wide source of silent production failures.
**Delivers:** WF-Error (Slack alerts, Supabase `pipeline_errors` inserts), canary monitoring external to n8n, HMAC validation Code node tested in isolation.
**Addresses:** CM-1 (silent failures), CM-2 (trigger deactivation), EH-1 (error trigger opt-in), RP-3 (HMAC validation)
**Avoids:** The scenario documented in PITFALLS.md where an 847-workflow instance ran 14 months with zero error handling configured.

### Phase 3: Webhook Security and Supabase Integration
**Rationale:** Connects n8n to Supabase Edge Functions for the first time. HMAC signing and validation must be proven end-to-end before any workflow posts real data. This phase validates the existing Edge Functions work correctly with n8n as the caller.
**Delivers:** HMAC Code node working in production against all 4 Edge Functions, n8n environment variable `N8N_WEBHOOK_SECRET` matching Supabase secret, SEC-4/SEC-5/SEC-6 hardening applied.
**Addresses:** RP-3, SEC-2, SEC-4, SEC-5, SEC-6
**Uses:** Existing `_shared/hmac.ts` — the Edge Functions already implement the server side; this phase wires in the n8n client side.

### Phase 4: Leaf Workflows (WF-5 and WF-3)
**Rationale:** WF-5 (Status Poller) and WF-3 (Research Sub-Workflow) have zero dependencies on other workflows and can be built, tested, and run in parallel with existing Vercel crons. This produces immediate value (WF-5 replaces the check-status cron) and validates the full n8n-to-Next.js-to-Edge-Function round-trip with real data.
**Delivers:** WF-5 (Status Poller) replacing `check-status` Vercel cron after 48h of matched results; WF-3 (Research Sub-Workflow) tested with known topic_ids.
**Addresses:** CM-4 (retry/continue conflict), CM-5 (workflow locks), EH-4 (loop circuit breakers)
**Avoids:** Building complex workflows before the base integration is proven stable.

### Phase 5: Worker Workflows (WF-4 and WF-2)
**Rationale:** WF-4 (Publish Pipeline) depends only on Supabase data and calls the existing `/api/cron/daily-publish` route — lowest complexity of the remaining workflows. WF-2 (Media Pipeline) is the most complex (6 parallel branches, fan-out pattern) and depends on WF-5 already being stable for async video resolution. Build WF-4 first, then WF-2.
**Delivers:** WF-4 replacing `daily-publish` Vercel cron; WF-2 replacing `daily-media` Vercel cron with parallel asset generation. Both Vercel crons disabled after 48h of stable n8n operation.
**Implements:** Fan-out parallel execution (FEATURES.md Differentiator #2), dynamic content-type routing via Switch node (Differentiator #3), Dead Letter Queue for unrecoverable failures (Differentiator #6)
**Addresses:** PS-1 (payload size — pass IDs not content), PS-2 (Node.js heap), PS-3 (sub-workflow memory), PS-5 (concurrent AI API rate limits)

### Phase 6: Orchestrator (WF-1)
**Rationale:** WF-1 is the top-level orchestrator that calls WF-3 as a synchronous sub-workflow and fires WF-2 via webhook. It is built last because it depends on WF-3 being stable and is the workflow the dashboard "Generate and Schedule" button targets.
**Delivers:** Full end-to-end pipeline triggered from the dashboard; all 3 Vercel crons replaced and disabled.
**Uses:** Execute Sub-Workflow (synchronous, WF-1 to WF-3), webhook fire-and-forget (WF-1 to WF-2), correlation ID propagation across all workflows
**Addresses:** Anti-Feature #1 (no polling loops), Anti-Feature #2 (no monolithic workflow), Anti-Feature #5 (direct webhook chaining instead of cron polling)

### Phase 7: Observability and Hardening
**Rationale:** After all 5 workflows are running, add the operational layer that makes the system maintainable. This includes the Daily Summary cron (WF-6), DLQ monitoring, Vercel cold start tuning, and the full pre-launch reliability checklist from PITFALLS.md.
**Delivers:** WF-6 (daily Slack summary), DLQ alert on Supabase insert trigger, simulated downtime test for RP-1 (offline webhook loss), full reboot test confirming all workflows re-activate via WinSW.
**Addresses:** RP-1 (offline webhook loss), RP-2 (Vercel cold starts), WS-2/WS-3 (Windows file paths, Defender exclusions), EH-3 (community node audit), RP-5 (post-upgrade trigger verification)

### Phase Ordering Rationale

- Phases 1-3 are pure infrastructure with no workflow logic — they must be stable before any n8n cron fires in production, because a broken foundation cannot be fixed with the pipeline running
- Phases 4-5 follow the leaf-first, then worker order from ARCHITECTURE.md, enabling parallel operation with existing Vercel crons during cutover rather than a big-bang switch
- Phase 6 (orchestrator) is last because all of its dependencies (WF-3, WF-2, Error Handler) must be production-stable before it becomes the dashboard's primary action target
- Phase 7 is explicitly post-cutover — adding observability to a running stable system is lower risk than adding it during construction

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (WF-2 Media Pipeline):** The 6-branch parallel fan-out with async video resolution is the most technically complex part of this project. The fan-out pattern (FEATURES.md Differentiator #2) requires verifying whether n8n's Execute Sub-Workflow in fire-and-forget mode correctly handles all 6 branches in parallel without hitting the `N8N_CONCURRENCY_PRODUCTION_LIMIT`. Recommend a spike workflow before full implementation.
- **Phase 3 (HMAC end-to-end):** The raw body vs. parsed body issue (RP-3) is well-documented but the exact n8n Code node API for accessing raw request bytes (`$request.body` buffer) should be validated against the actual n8n 2.9.0 runtime before building all 4 webhook validation nodes on top of it.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Infrastructure):** Docker + WSL2 + PostgreSQL setup is exhaustively documented. The STACK.md docker-compose configuration is complete and ready to use.
- **Phase 2 (Error Handler):** Error Trigger workflow is a well-documented n8n primitive; straightforward Slack webhook integration.
- **Phase 4 (WF-5 Status Poller):** Mirrors the existing `check-status` cron logic exactly; the business logic already exists in Next.js and just needs to be replicated in n8n nodes.
- **Phase 6 (WF-4 Publish Pipeline):** Calls the existing `/api/cron/daily-publish` route which already works; lowest-risk workflow migration.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core decisions (Docker/WSL2, PostgreSQL, Cloudflare Tunnel, version pinning) are confirmed by official docs and community consensus. The two-timezone requirement and encryption key persistence are particularly well-sourced. |
| Features | HIGH | Feature dependency graph is well-researched with specific n8n pattern references for each differentiator. Anti-features are confirmed by multiple independent sources. |
| Architecture | HIGH | Codebase was directly analyzed — the 4 Edge Functions and shared HMAC library are confirmed existing. Workflow topology is grounded in the actual Next.js routes and Supabase schema. |
| Pitfalls | HIGH | CM-1, CM-2, CM-3 are the most practically significant; all confirmed by community reports, GitHub issues, or CVE disclosures. Windows-specific pitfalls are all documented with specific fixes. |

**Overall confidence:** HIGH

### Gaps to Address

- **HeyGen native callback support:** ARCHITECTURE.md documents that HeyGen's basic API tier does not support configurable webhook callbacks, making the Wait node + resume pattern inapplicable. This should be re-verified if HeyGen's API tier is upgraded before implementation — if callbacks are available, Pattern B (Wait node resume) is architecturally cleaner than the sweeper.

- **Cloudflare Tunnel domain ownership:** The tunnel setup requires a domain registered with Cloudflare. If the project does not already have a Cloudflare-managed domain, this step adds setup time in Phase 1. ngrok is a valid fallback for development but must not be used in production (URL changes on restart break all stored webhook references in the app and Supabase).

- **n8n concurrent execution limit under 6-branch fan-out:** WF-2 generates 6 parallel media branches per topic. The `N8N_CONCURRENCY_PRODUCTION_LIMIT` default and whether 6 sub-workflow slots are consumed simultaneously needs validation during the Phase 5 spike. If the limit is hit, batch processing (topic by topic, not branch by branch) may be needed.

- **`continue on fail` + retry bug scope (CM-4):** GitHub issue #9236 is documented for the HTTP Request node. Whether this bug affects other node types (e.g., Supabase node) in n8n 2.9.0 is not confirmed. Audit all nodes during Phase 4 workflow implementation.

---

## Sources

### Primary (HIGH confidence — official docs, CVE disclosures, direct codebase analysis)
- n8n Official Docs (docs.n8n.io) — Docker installation, environment variables, Schedule Trigger, Webhook, Sub-workflows, Concurrency, Error handling, Binary data
- CVE-2026-21858 — The Hacker News, n8n Security Advisory Blog, Horizon3.ai analysis
- GitHub Issues #9236 (retry/continue bug), #18501 (infinite retry loop on missing community nodes)
- Direct codebase analysis — `supabase/functions/` Edge Functions, `_shared/hmac.ts`, existing Vercel cron routes

### Secondary (MEDIUM confidence — community consensus, multiple sources agree)
- n8n Community Forum — PM2 Windows autostart failures, Schedule Trigger deactivation, HMAC body parsing issues
- Northflank, logicworkflow.com, wednesday.is — n8n production deployment guides
- nocodecreative.io — Wait node sub-workflow patterns in n8n 2.x
- Cloudflare Tunnel as preferred webhook exposure — community recommendation, widely adopted pattern

### Tertiary (MEDIUM-LOW confidence — single source or inference)
- Releasebot.io — n8n 2.9.0 as latest stable February 2026 (confirm with GitHub releases before setup)
- HeyGen basic API tier lacking configurable callbacks — inferred from architecture research; verify against current HeyGen API docs before implementing WF-5
- `$request.body` raw buffer access in n8n 2.9.0 Code node — documented behavior but validate in runtime before building all HMAC validation nodes on it

---

*Research completed: 2026-02-22*
*Ready for roadmap: yes*
