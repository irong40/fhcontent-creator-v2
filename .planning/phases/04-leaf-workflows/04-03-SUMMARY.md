---
phase: 04-leaf-workflows
plan: "04-03"
subsystem: infra
tags: [n8n, sub-workflow, research, hmac, supabase, edge-functions]

requires:
  - phase: 03-webhook-security
    provides: HMAC signing pattern validated against n8n-research-callback
  - phase: 02-error-infrastructure
    provides: pipeline_runs table and WF-Error handler
provides:
  - WF-3 Research Sub-Workflow JSON (wf3-research.json)
  - Synchronous sub-workflow pattern for Execute Sub-Workflow invocation
  - HMAC-signed callback to n8n-research-callback Edge Function
  - correlation_id propagation from parent WF-1 through all nodes
affects: [06-orchestrator-cutover]

tech-stack:
  added: []
  patterns:
    - "Execute Workflow Trigger for sub-workflow entry (not Schedule/Webhook)"
    - "Input validation with topic_id/correlation_id required fields"
    - "Return to parent workflow via terminal Code node output"
    - "CRON_SECRET as Authorization Bearer header on Next.js API calls"

key-files:
  created:
    - n8n-workflows/wf3-research.json
  modified: []

key-decisions:
  - "Used Execute Workflow Trigger (not Webhook) since WF-3 is purely synchronous sub-workflow"
  - "Research route called with CRON_SECRET Bearer auth header (SEC-05 compliance)"
  - "Return to WF-1 node outputs success:true with topic_id and correlation_id for parent consumption"
  - "50s timeout on research route since Claude research can be slow"

patterns-established:
  - "Sub-workflow pattern: Execute Workflow Trigger → Validate Input → Log Start → HTTP Work → Log Complete → Return to Parent"
  - "All inter-service calls carry Authorization Bearer + X-Correlation-ID headers"

requirements-completed: [WF-03, SEC-05]

duration: 8min
completed: 2026-02-27
---

# Plan 04-03: WF-3 Research Sub-Workflow Summary

**WF-3 Research Sub-Workflow built as synchronous sub-workflow with CRON_SECRET auth, HMAC-signed callback, and correlation_id propagation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-27
- **Completed:** 2026-02-27
- **Tasks:** 4
- **Files modified:** 1

## Accomplishments
- WF-3 created with Execute Workflow Trigger (synchronous sub-workflow entry)
- Input validation ensures topic_id and correlation_id are present
- Research API call uses CRON_SECRET Bearer auth (SEC-05)
- HMAC-signed POST to n8n-research-callback Edge Function
- pipeline_runs captures WF-3 start and completion with correlation_id
- Terminal "Return to WF-1" node provides success signal to parent workflow

## Task Commits

Each task was committed atomically:

1. **Task 1-4: WF-3 Research Sub-Workflow complete** - single commit (feat)

## Files Created/Modified
- `n8n-workflows/wf3-research.json` - Complete WF-3 Research Sub-Workflow with 12 nodes

## Decisions Made
- Execute Workflow Trigger used (not Webhook) since WF-3 is called synchronously from WF-1
- CRON_SECRET sent as Bearer auth header on Next.js research route (not x-cron-secret)
- 50s timeout on research route to accommodate Claude's research generation time

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered
None

## User Setup Required
- Import wf3-research.json into n8n UI
- Ensure credentials exist: "Vercel Cron Secret", "Supabase Service Role", "N8N Signing Secret"
- Do NOT activate -- WF-3 is a sub-workflow invoked by WF-1 (Phase 6)

## Next Phase Readiness
- WF-3 ready for WF-1 (Phase 6) to invoke via Execute Sub-Workflow node
- Synchronous sub-workflow pattern established and documented

---
*Phase: 04-leaf-workflows*
*Completed: 2026-02-27*
