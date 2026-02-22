# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Reliable, observable content pipeline orchestration where every step is visible, retryable, and debuggable through n8n's visual workflow editor — replacing opaque 300-second Vercel cron jobs that fail silently.
**Current focus:** Phase 1 — Infrastructure Foundation

## Current Position

Phase: 1 of 6 (Infrastructure Foundation)
Plan: 0 of 4 in current phase
Status: Ready to plan
Last activity: 2026-02-22 — n8n Orchestration roadmap created; 36 requirements mapped across 6 phases

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*

## Accumulated Context

### Decisions

- Architecture: n8n calls existing Next.js API routes only — no business logic duplicated in n8n nodes
- Architecture: Async media APIs (HeyGen/Blotato) use WF-5 Scheduled Sweeper pattern, not Wait node resume (Windows restarts silently drop in-progress Wait executions)
- Infrastructure: PostgreSQL 15 required before any workflow runs — SQLite hits SQLITE_BUSY under concurrent cron load
- Security: N8N_ENCRYPTION_KEY must be a fixed 64-char string set before first launch — auto-generated keys are lost on reinstall

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 3 research flag: `$request.body` raw buffer access in n8n 2.9.0 Code nodes must be validated before building all 4 HMAC signing nodes on top of it (run /gsd:research-phase before planning Phase 3)
- Phase 5 research flag: WF-2's 6-branch parallel fan-out may hit N8N_CONCURRENCY_PRODUCTION_LIMIT — spike workflow needed before full implementation (run /gsd:research-phase before planning Phase 5)
- Cloudflare Tunnel: Requires a domain registered with Cloudflare; if not already set up, this is a Phase 1 blocker. ngrok is development-only fallback (URL changes on restart break all stored webhook references).

## Session Continuity

Last session: 2026-02-22
Stopped at: Roadmap and STATE.md created; no plans written yet
Resume file: None
