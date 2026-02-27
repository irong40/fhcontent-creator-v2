---
phase: 04-leaf-workflows
plan: "04-02"
subsystem: infra
tags: [n8n, retry, exponential-backoff, error-handling, dlq]

requires:
  - phase: 04-leaf-workflows
    provides: WF-5 Status Poller base workflow (04-01)
provides:
  - Code+Wait exponential backoff retry pattern on all WF-5 HTTP nodes
  - Error classification (429/5xx retryable, other 4xx non-retryable)
  - DLQ insert for undeliverable asset callbacks
  - Lock release with 5 retry attempts (critical path)
affects: [04-04, 05-worker-workflows]

tech-stack:
  added: []
  patterns:
    - "Code+Wait retry loop: Classify Error → Retryable? → Increment Attempt → Exhausted? → Backoff Wait → loop back"
    - "Error classification: 429 + 5xx = retryable, other 4xx = non-retryable immediate fail"
    - "Exponential backoff: 2^attempt seconds (2s, 4s, 8s)"
    - "DLQ insert for exhausted callback retries (pipeline_dlq table)"

key-files:
  created: []
  modified:
    - n8n-workflows/wf5-status-poller.json

key-decisions:
  - "Lock release gets 5 retry attempts (not 3) since stale locks block all future executions"
  - "Asset callback exhaustion routes to DLQ insert (pipeline_dlq) instead of WF-Error since partial success is possible"
  - "Init Retry nodes added before each HTTP node to set _attempt=0 cleanly"
  - "Non-retryable errors from Asset Callback also route to DLQ (not WF-Error) for consistency"

patterns-established:
  - "Retry sub-pattern: Init Retry → HTTP Request → [success/error] → Classify Error → Retryable? → Increment Attempt → Exhausted? → Backoff Wait → loop back to HTTP Request"
  - "DLQ pattern: Build DLQ Entry code node → HTTP POST to pipeline_dlq"

requirements-completed: [ERR-04]

duration: 12min
completed: 2026-02-27
---

# Plan 04-02: WF-5 Retry Hardening Summary

**Code+Wait exponential backoff loops added to all 4 HTTP nodes in WF-5 with error classification, DLQ for callbacks, and 5-attempt lock release**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-27
- **Completed:** 2026-02-27
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments
- All HTTP Request nodes wrapped with Code+Wait exponential backoff retry loops
- Error classification distinguishes retryable (429, 5xx) from non-retryable (other 4xx)
- Asset callback exhaustion routes to pipeline_dlq table (not WF-Error) for partial success tracking
- Lock release gets 5 retry attempts (critical path to prevent stale locks)
- Zero built-in retryOnFail flags used -- all retry logic is explicit via Code+Wait pattern

## Task Commits

Each task was committed atomically:

1. **Task 2-4: WF-5 retry hardening complete** - single commit (feat)

## Files Created/Modified
- `n8n-workflows/wf5-status-poller.json` - Updated with 4 retry loops (Log Start, Check-Status, Asset Callback, Lock Release, Log Complete) adding ~30 new nodes

## Decisions Made
- Lock release uses 5 max attempts instead of 3 since a stale lock blocks all future WF-5 executions
- Asset callback failure routes to DLQ instead of WF-Error since other callbacks may have succeeded
- Each retry loop has an Init Retry node to cleanly set _attempt=0 on the first pass

## Deviations from Plan

None - plan executed as specified.

## Issues Encountered
None

## User Setup Required
- Re-import updated wf5-status-poller.json into n8n to replace the base version from 04-01

## Next Phase Readiness
- Code+Wait retry pattern documented and ready to apply to WF-2 (Phase 5) and WF-4 (Phase 5)
- WF-5 is fully hardened for production use

---
*Phase: 04-leaf-workflows*
*Completed: 2026-02-27*
