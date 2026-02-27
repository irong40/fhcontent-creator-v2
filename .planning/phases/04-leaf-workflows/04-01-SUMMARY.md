---
phase: 04-leaf-workflows
plan: "04-01"
subsystem: infra
tags: [n8n, workflow, polling, hmac, supabase, edge-functions]

requires:
  - phase: 03-webhook-security
    provides: HMAC signing pattern validated against all 4 Edge Functions
  - phase: 02-error-infrastructure
    provides: pipeline_runs, pipeline_errors tables and WF-Error handler
provides:
  - WF-5 Status Poller n8n workflow JSON (wf5-status-poller.json)
  - 10-minute schedule trigger with workflow lock pattern
  - HMAC-signed callback to n8n-asset-callback Edge Function
  - pipeline_runs logging for execution tracking
affects: [04-02, 04-04, 05-worker-workflows]

tech-stack:
  added: []
  patterns:
    - "n8n Schedule Trigger + workflow_locks acquisition pattern"
    - "HMAC signing via Code node with crypto.createHmac"
    - "pipeline_runs start/complete lifecycle logging"
    - "Has Updates? branch to skip empty callback cycles"

key-files:
  created:
    - n8n-workflows/wf5-status-poller.json
  modified: []

key-decisions:
  - "Added Has Updates? IF node to skip HMAC/callback when check-status returns zero updates — avoids unnecessary Edge Function calls"
  - "Lock key set to 'wf5-status-poller' matching workflow_locks table convention"
  - "Timeout on check-status call set to 55s (under Vercel's 60s function timeout)"
  - "Error outputs route to WF-Error via Execute Workflow node (global error handler)"

patterns-established:
  - "Schedule Trigger → Correlation Context → Lock Acquire → IF Lock → Work → Lock Release → Log Complete"
  - "HMAC signing: JSON.stringify body → crypto.createHmac('sha256', secret) → sha256= prefix"

requirements-completed: [WF-05, INT-03, WF-06, INT-01]

duration: 8min
completed: 2026-02-27
---

# Plan 04-01: WF-5 Status Poller Summary

**WF-5 Status Poller workflow built with 10-min schedule, workflow lock, HMAC-signed asset callbacks, and pipeline_runs lifecycle logging**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-27
- **Completed:** 2026-02-27
- **Tasks:** 4
- **Files modified:** 1

## Accomplishments
- WF-5 Status Poller workflow created as importable n8n JSON
- Schedule Trigger fires every 10 minutes with workflow lock preventing concurrent runs
- All HTTP Request nodes carry X-Correlation-ID header set to execution run_id
- HMAC-signed POST to n8n-asset-callback Edge Function for each status update
- pipeline_runs captures start (running) and finish (completed) timestamps
- No business logic in n8n — all processing in Next.js /api/cron/check-status route (INT-01)

## Task Commits

Each task was committed atomically:

1. **Task 1-4: WF-5 Status Poller complete workflow** - single commit (feat)

## Files Created/Modified
- `n8n-workflows/wf5-status-poller.json` - Complete WF-5 Status Poller workflow definition with 13 nodes

## Decisions Made
- Added "Has Updates?" IF node to skip HMAC signing and callback when check-status returns zero updated pieces
- Used `onError: continueRegularOutput` on HTTP nodes to allow error handling in downstream flow
- Lock release always executes whether updates path or no-updates path (both converge to Release Workflow Lock)

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered
None

## User Setup Required
- Import wf5-status-poller.json into n8n UI
- Ensure credentials exist: "Vercel Cron Secret", "Supabase Service Role", "N8N Signing Secret"
- Activate workflow after importing

## Next Phase Readiness
- Ready for 04-02 (retry hardening) to wrap HTTP nodes with exponential backoff
- Ready for 04-04 (cutover) after retry hardening is complete

---
*Phase: 04-leaf-workflows*
*Completed: 2026-02-27*
