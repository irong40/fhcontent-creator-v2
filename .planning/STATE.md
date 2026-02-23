# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Reliable, observable content pipeline orchestration where every step is visible, retryable, and debuggable through n8n's visual workflow editor — replacing opaque 300-second Vercel cron jobs that fail silently.
**Current focus:** Phase 1 — Infrastructure Foundation

## Current Position

Phase: 1 of 6 (Infrastructure Foundation)
Plan: 2 of 4 in current phase
Status: In progress
Last activity: 2026-02-23 — Plan 01-02 complete: Cloudflare Tunnel live at https://n8n.faithandharmonyllc.com

Progress: [██░░░░░░░░] 8%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 8 min
- Total execution time: 0.27 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation | 2/4 | 16 min | 8 min |

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

Last session: 2026-02-23
Stopped at: Plans 01-01 and 01-02 complete; 01-03 awaiting reboot verification (Task 3 checkpoint)
Resume file: None
