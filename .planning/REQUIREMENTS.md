# Requirements: Content Command Center — n8n Orchestration

**Defined:** 2026-02-22
**Core Value:** Reliable, observable content pipeline orchestration where every step is visible, retryable, and debuggable through n8n's visual workflow editor — replacing opaque 300-second Vercel cron jobs that fail silently.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure

- [ ] **INFRA-01**: n8n 2.9.0 runs via Docker Desktop + WSL2 on local Windows machine
- [ ] **INFRA-02**: PostgreSQL 15 is the n8n internal database (not SQLite)
- [ ] **INFRA-03**: Cloudflare Tunnel exposes n8n webhooks to public internet with stable URL
- [ ] **INFRA-04**: n8n auto-starts on Windows boot via WinSW service wrapper
- [ ] **INFRA-05**: All API credentials (Claude, HeyGen, Blotato, ElevenLabs, Gemini, OpenAI, Canva, Supabase) stored in n8n credential store with fixed N8N_ENCRYPTION_KEY
- [ ] **INFRA-06**: Dual timezone env vars set (TZ + GENERIC_TIMEZONE = America/New_York)
- [ ] **INFRA-07**: Execution history pruning enabled (7-day retention)
- [ ] **INFRA-08**: Windows power plan set to High Performance (no sleep/hibernate)

### Security

- [ ] **SEC-01**: n8n version >= 2.5.2 (above CVE-2026-21858 patch threshold)
- [ ] **SEC-02**: HMAC-SHA256 signing on all n8n to Supabase Edge Function calls using N8N_WEBHOOK_SECRET
- [ ] **SEC-03**: HMAC validation tested end-to-end against all 4 existing Edge Functions before production use
- [ ] **SEC-04**: n8n port 5678 not exposed to public internet
- [ ] **SEC-05**: Cron API routes still validate CRON_SECRET header during transition period

### Error Handling

- [ ] **ERR-01**: Global Error Trigger workflow (WF-Error) catches failures from all 5 workflows
- [ ] **ERR-02**: Error notifications sent to Slack/webhook with workflow name, node name, error message, and timestamp
- [ ] **ERR-03**: Pipeline errors logged to Supabase `pipeline_errors` table for queryability
- [ ] **ERR-04**: Node-level retry with exponential backoff (Loop + Wait pattern) for external API calls
- [ ] **ERR-05**: Dead Letter Queue table (`pipeline_dlq`) stores unrecoverable failures for manual replay

### Workflows

- [ ] **WF-01**: Topic Pipeline (WF-1) triggers from dashboard webhook, calls `/api/topics/generate`, executes research sub-workflow synchronously, fires media pipeline asynchronously
- [ ] **WF-02**: Media Pipeline (WF-2) runs on 6AM cron + webhook trigger, generates all 6 media assets per topic in parallel branches (HeyGen long, Blotato shorts x4, thumbnail, carousel, podcast, music)
- [ ] **WF-03**: Research Sub-Workflow (WF-3) executes synchronously within WF-1, posts results to `n8n-research-callback` Edge Function
- [ ] **WF-04**: Publish Pipeline (WF-4) runs on hourly cron + webhook trigger, calls existing `/api/cron/daily-publish` route, posts confirmations to `n8n-publish-callback` Edge Function
- [ ] **WF-05**: Status Poller (WF-5) runs every 10 minutes, polls HeyGen/Blotato for async job completion, writes results via `n8n-asset-callback` Edge Function
- [ ] **WF-06**: All workflows use correlation IDs (topic_id/content_piece_id) for cross-workflow debugging

### Integration

- [ ] **INT-01**: n8n calls existing Next.js API routes for all business logic (no duplicated TypeScript logic in n8n)
- [ ] **INT-02**: n8n writes back via existing 4 Supabase Edge Functions (topic, research, asset, publish callbacks)
- [ ] **INT-03**: Existing `workflow_locks` table used to prevent concurrent workflow execution
- [ ] **INT-04**: Dashboard "Generate" button fires webhook to n8n WF-1 (manual trigger)
- [ ] **INT-05**: n8n cron triggers replace all 3 Vercel cron schedules (6AM media, hourly publish, 10min status)

### Monitoring

- [ ] **MON-01**: Canary heartbeat workflow writes timestamp to Supabase every 1 minute; absence detected externally
- [ ] **MON-02**: Pipeline execution results logged to Supabase `pipeline_runs` table (queryable from dashboard)
- [ ] **MON-03**: All 3 Vercel cron entries removed from `vercel.json` after n8n workflows verified stable (48h parallel run)

### Cutover

- [ ] **CUT-01**: Each workflow runs in parallel with its Vercel cron counterpart for 48h before cron is disabled
- [ ] **CUT-02**: Status Poller (WF-5) replaces `check-status` cron first (lowest risk)
- [ ] **CUT-03**: Publish Pipeline (WF-4) replaces `daily-publish` cron second
- [ ] **CUT-04**: Media Pipeline (WF-2) replaces `daily-media` cron third
- [ ] **CUT-05**: All 3 Vercel cron routes removed after full cutover verified

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Observability

- **OBS-01**: Daily summary workflow (WF-6) posts pipeline health to Slack at 6PM
- **OBS-02**: DLQ alert triggers on Supabase insert (real-time notification for unrecoverable failures)
- **OBS-03**: Grafana/Prometheus dashboard for n8n execution metrics

### Advanced Orchestration

- **ADV-01**: Circuit breaker pattern per external API (pause calls after N consecutive failures)
- **ADV-02**: n8n queue mode with Redis for horizontal scaling
- **ADV-03**: Automated bidirectional GitHub sync for workflow version control
- **ADV-04**: Admin UI DLQ replay button for manual failure recovery

## Out of Scope

| Feature | Reason |
|---------|--------|
| Custom n8n nodes | Use built-in HTTP Request nodes to call existing API clients |
| Migrating service client logic into n8n | n8n calls Next.js API routes which use existing TypeScript clients |
| n8n cloud hosting | Runs locally on Windows rig per project constraints |
| Multi-tenant support | Single operator system |
| Mobile app / PWA | Web dashboard only |
| Direct external API calls from n8n | All calls route through Next.js API routes to preserve TypeScript type safety |
| Polling loops in n8n (anti-feature) | Use webhook callbacks and scheduled sweepers instead |
| Monolithic mega-workflow (anti-feature) | 5 separate workflows for visibility and independent deployment |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| INFRA-05 | Phase 1 | Pending |
| INFRA-06 | Phase 1 | Pending |
| INFRA-07 | Phase 1 | Pending |
| INFRA-08 | Phase 1 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-04 | Phase 1 | Pending |
| ERR-01 | Phase 2 | Pending |
| ERR-02 | Phase 2 | Pending |
| ERR-03 | Phase 2 | Pending |
| MON-01 | Phase 2 | Pending |
| MON-02 | Phase 2 | Pending |
| SEC-02 | Phase 3 | Pending |
| SEC-03 | Phase 3 | Pending |
| INT-02 | Phase 3 | Pending |
| WF-03 | Phase 4 | Pending |
| WF-05 | Phase 4 | Pending |
| WF-06 | Phase 4 | Pending |
| INT-01 | Phase 4 | Pending |
| INT-03 | Phase 4 | Pending |
| SEC-05 | Phase 4 | Pending |
| ERR-04 | Phase 4 | Pending |
| CUT-01 | Phase 4 | Pending |
| CUT-02 | Phase 4 | Pending |
| WF-02 | Phase 5 | Pending |
| WF-04 | Phase 5 | Pending |
| ERR-05 | Phase 5 | Pending |
| CUT-03 | Phase 5 | Pending |
| CUT-04 | Phase 5 | Pending |
| WF-01 | Phase 6 | Pending |
| INT-04 | Phase 6 | Pending |
| INT-05 | Phase 6 | Pending |
| MON-03 | Phase 6 | Pending |
| CUT-05 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 — traceability table finalized after roadmap creation (6 phases)*
