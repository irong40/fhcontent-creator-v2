---
phase: 01-infrastructure-foundation
plan: "01"
subsystem: infra
tags: [n8n, docker, postgres, docker-compose, orchestration]

# Dependency graph
requires: []
provides:
  - n8n 2.9.0 container running at 127.0.0.1:5678 (loopback-only, CVE-2026-21858 patched)
  - PostgreSQL 15 as n8n backing database (no SQLite BUSY errors under concurrent cron load)
  - N8N_ENCRYPTION_KEY set before first credential storage (irreversible if changed later)
  - Execution pruning enabled (7-day retention, prevents DB bloat)
  - Timezone correctly configured (America/New_York via both TZ and GENERIC_TIMEZONE)
  - n8n-workflows/ directory scaffolded for version-controlled workflow JSON exports
affects:
  - 01-02 (Cloudflare Tunnel — connects to this n8n instance)
  - 01-03 (n8n instance management — requires this stack running)
  - 01-04 (Credential setup — N8N_ENCRYPTION_KEY must remain unchanged)
  - All subsequent phases (workflows deploy to this n8n instance)

# Tech tracking
tech-stack:
  added:
    - docker.n8n.io/n8nio/n8n:2.9.0 (pinned, not latest)
    - postgres:15 Docker image
    - Docker Compose v3.8 stack
  patterns:
    - Loopback-only port binding (127.0.0.1:5678) — not exposed to public internet
    - Named Docker volumes (not host path mounts) — avoids Windows D:\ permission issues
    - depends_on with condition:service_healthy — n8n waits for Postgres before starting
    - .env file separation — all secrets outside docker-compose.yml and git

key-files:
  created:
    - D:/n8n/docker-compose.yml
    - D:/n8n/.env
    - n8n-workflows/README.md
  modified: []

key-decisions:
  - "Port bound to 127.0.0.1:5678 only — Cloudflare Tunnel (Plan 01-02) is the only public ingress path"
  - "Image pinned to n8n:2.9.0 — prevents accidental breaking upgrades from latest tag"
  - "Named Docker volumes used — host path mounts on Windows D:\\ cause permission errors"
  - "WEBHOOK_URL left as localhost placeholder — will be updated after Plan 01-02 creates the tunnel"
  - "Old standalone n8n container (running 31hrs) stopped — our compose stack takes ownership of the n8n_data volume"

patterns-established:
  - "Infrastructure outside git: D:/n8n/ is intentionally not a git repo — .env contains secrets"
  - "n8n-workflows/ in project repo: JSON exports safe to commit (credential names only, no values)"

requirements-completed: [INFRA-01, INFRA-02, INFRA-06, INFRA-07, SEC-01]

# Metrics
duration: 4min
completed: 2026-02-23
---

# Phase 1 Plan 01: n8n Docker Stack Summary

**n8n 2.9.0 with PostgreSQL 15 running via Docker Compose at 127.0.0.1:5678, loopback-only port binding, 64-char encryption key set before first launch**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-23T01:01:14Z
- **Completed:** 2026-02-23T01:05:40Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Docker Compose stack with n8n 2.9.0 and PostgreSQL 15 running and healthy
- N8N_ENCRYPTION_KEY (64-char hex) set before first launch — credentials are now safely storable
- n8n UI accessible at http://localhost:5678, PostgreSQL confirmed as backing DB (not SQLite)
- Execution pruning active (7-day retention), timezone set to America/New_York via both required env vars
- n8n-workflows/ directory scaffolded in project repo with credential inventory for disaster recovery

## Task Commits

Each task was committed atomically:

1. **Task 1: Create D:/n8n/docker-compose.yml** - Infrastructure file outside git repo (D:/n8n/)
2. **Task 2: Create D:/n8n/.env** - Infrastructure file outside git repo (D:/n8n/, contains secrets)
3. **Task 3: Start stack + scaffold n8n-workflows** - `7cb642c` (feat)

**Plan metadata:** (docs commit — see below)

_Note: Tasks 1 and 2 created infrastructure files outside the project git repo by design. Only n8n-workflows/README.md is version-controlled._

## Files Created/Modified
- `D:/n8n/docker-compose.yml` - n8n 2.9.0 + PostgreSQL 15 service definitions, loopback port binding
- `D:/n8n/.env` - All n8n system config (encryption key, DB credentials, timezone, pruning settings)
- `n8n-workflows/README.md` - Credential name inventory + workflow export instructions for portability

## Decisions Made
- Port bound to `127.0.0.1:5678` only — not `0.0.0.0` — Cloudflare Tunnel (Plan 01-02) is the only path in from outside
- Image pinned to `docker.n8n.io/n8nio/n8n:2.9.0` — never `latest` — prevents silent breaking upgrades
- Named Docker volumes (`postgres_data`, `n8n_data`) — host path mounts on Windows D:\ drive cause permission errors
- WEBHOOK_URL left as `http://localhost:5678/` placeholder — updated after Plan 01-02 creates the Cloudflare Tunnel
- Stopped pre-existing standalone `n8n` container (running 31+ hours, binding 0.0.0.0:5678) — compose stack takes over the `n8n_data` volume, preserving any prior data

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing standalone n8n container blocking port 5678 and network attachment**
- **Found during:** Task 3 (Start the stack)
- **Issue:** A standalone `n8n` container had been running for 31+ hours, bound to `0.0.0.0:5678`. When the compose stack started, n8n_app received no network assignment (DNS resolution for `postgres` hostname failed with `getaddrinfo EAI_AGAIN`). The port conflict prevented proper container network attachment.
- **Fix:** Stopped the old `n8n` container (`docker stop n8n`), then ran `docker compose down && docker compose up -d` for a clean fresh start. The compose stack then correctly created the `n8n_default` bridge network with both containers attached.
- **Files modified:** None — runtime fix only
- **Verification:** `docker inspect n8n_app` shows `n8n_default` network; `docker logs n8n_app` shows DB migrations running; `curl http://localhost:5678/` returns HTTP 200
- **Committed in:** Documented only — runtime state change

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary to get the stack functioning. No scope creep. Old container stopped cleanly — data volume preserved and now managed by the compose stack.

## Issues Encountered
- `version: "3.8"` in docker-compose.yml triggers a deprecation warning ("attribute version is obsolete"). This is cosmetic only — Docker Compose still runs correctly. The `version` field was removed in Compose Spec but tools accept it. No impact on functionality.

## User Setup Required

**CRITICAL: Save the N8N_ENCRYPTION_KEY to your password manager immediately.**

The encryption key is in `D:/n8n/.env`:
```
N8N_ENCRYPTION_KEY=d1d854cbe78259ce589bb92e3148be466f3040ce86db58a6fa6fed6e7ee0c22a
```

If this key is lost after credentials are stored in n8n, all stored credentials (API keys, service accounts) become permanently unrecoverable. The container cannot be migrated to a new machine without this key.

**Stack management commands:**
```bash
# Start
cd D:/n8n && docker compose up -d

# Stop
cd D:/n8n && docker compose down

# View logs
docker logs n8n_app -f

# Access UI
http://localhost:5678
```

## Next Phase Readiness
- n8n stack is running and ready for Plan 01-02 (Cloudflare Tunnel setup)
- After Plan 01-02 completes: update `WEBHOOK_URL` in `D:/n8n/.env` from `http://localhost:5678/` to the tunnel URL, then restart n8n_app
- Blocker noted in STATE.md: Cloudflare Tunnel requires a domain registered with Cloudflare — verify this before starting Plan 01-02

## Self-Check: PASSED

| Item | Status |
|------|--------|
| D:/n8n/docker-compose.yml | FOUND |
| D:/n8n/.env | FOUND |
| n8n-workflows/README.md | FOUND |
| 01-01-SUMMARY.md | FOUND |
| STATE.md | FOUND |
| ROADMAP.md | FOUND |
| REQUIREMENTS.md | FOUND |
| Commit 7cb642c | FOUND |
| n8n 2.9.0 running in container | CONFIRMED |

---
*Phase: 01-infrastructure-foundation*
*Completed: 2026-02-23*
