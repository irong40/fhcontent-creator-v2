# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Reliable, observable content pipeline orchestration where every step is visible, retryable, and debuggable through n8n's visual workflow editor — replacing opaque 300-second Vercel cron jobs that fail silently.
**Current focus:** Phase 1 — Infrastructure Foundation

## Current Position

Phase: 2+3 of 6 (Error Infra + Webhook Security — PARALLEL)
Plan: 0 of 6 in current phases
Status: Ready to start
Last activity: 2026-02-26 — Phase 1 COMPLETE: 4/4 plans done, 8 credentials, timezone validated

Progress: [████░░░░░░] 19%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 10 min
- Total execution time: 0.65 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation | 4/4 DONE | 41 min | 10.3 min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

- Architecture: n8n calls existing Next.js API routes only — no business logic duplicated in n8n nodes
- Architecture: Async media APIs (HeyGen/Blotato) use WF-5 Scheduled Sweeper pattern, not Wait node resume (Windows restarts silently drop in-progress Wait executions)
- Infrastructure: PostgreSQL 15 required before any workflow runs — SQLite hits SQLITE_BUSY under concurrent cron load
- Security: N8N_ENCRYPTION_KEY must be a fixed 64-char string set before first launch — auto-generated keys are lost on reinstall
- Infrastructure: Port bound to 127.0.0.1:5678 only — Cloudflare Tunnel (Plan 01-02) is the only public ingress path (Plan 01-01)
- Infrastructure: Named Docker volumes used for n8n — host path mounts on Windows D:\ cause permission errors (Plan 01-01)
- Infrastructure: n8n image pinned to 2.9.0 — never latest — prevents silent breaking upgrades (Plan 01-01)
- Infrastructure: Public webhook URL is https://n8n.faithandharmonyllc.com — domain faithandharmonyllc.com added to Cloudflare (Plan 01-02)
- Infrastructure: cloudflared installed as Windows service via token mode — auto-starts on boot (Plan 01-02)
- Infrastructure: docker compose restart does NOT reload env_file — must use docker compose up -d to recreate container (Plan 01-02)

### Pending Todos

- Save N8N_ENCRYPTION_KEY to password manager: `d1d854cbe78259ce589bb92e3148be466f3040ce86db58a6fa6fed6e7ee0c22a`
- ~~Update WEBHOOK_URL in D:/n8n/.env after Plan 01-02~~ DONE — set to https://n8n.faithandharmonyllc.com/
- **Blotato community node available**: `@blotato/n8n-nodes-blotato` (https://www.npmjs.com/package/@blotato/n8n-nodes-blotato) — official n8n community node for Blotato. Use this instead of raw HTTP Request nodes for post creation, status polling, and publishing. Install via n8n Settings → Community Nodes → Install `@blotato/n8n-nodes-blotato`.

### Blockers/Concerns

- Phase 3 research flag: `$request.body` raw buffer access in n8n 2.9.0 Code nodes must be validated before building all 4 HMAC signing nodes on top of it (run /gsd:research-phase before planning Phase 3)
- Phase 5 research flag: WF-2's 6-branch parallel fan-out may hit N8N_CONCURRENCY_PRODUCTION_LIMIT — spike workflow needed before full implementation (run /gsd:research-phase before planning Phase 5)
- ~~Cloudflare Tunnel blocker~~ RESOLVED — faithandharmonyllc.com added to Cloudflare, tunnel n8n-prod running

## Session Continuity

Last session: 2026-02-26
Stopped at: Phase 1 COMPLETE. Phases 2+3 ready to start in parallel (error infra + webhook security)
Resume file: None
Next action: /gsd:plan-phase for Phase 2 and Phase 3 (can be planned in parallel)
