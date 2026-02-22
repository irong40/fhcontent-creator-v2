# FHContent Creator v2 — Task Plan

## Objective
Stabilize the Content Command Center by fixing all known issues, closing tech debt, and preparing for production reliability. PRD v2.0 written; first wave of 7 fixes applied. Remaining work organized into phases below.

---

## Phase 1: Critical Fixes (COMPLETED)
> 7 issues fixed this session

- [x] H1 — Analytics pull skips zero-metric rows (Blotato has no engagement data)
- [x] H2 — Removed duplicate publish path from carousel route
- [x] H3/H4/L9 — JSON.parse try/catch in podcast, carousel, topic routes
- [x] H6/H7/L4 — Missing env vars in .env.example (NEXT_PUBLIC_SITE_URL, N8N_WEBHOOK_SECRET, OPENAI_API_KEY docs)
- [x] M1 — RSS enclosure length fetches real file size via HEAD request
- [x] M4 — Cost service naming standardized to 'claude' (was 'anthropic' in 2 routes)
- [x] M3 — Blotato ThreadsTarget + BlueskyTarget types added, unsafe cast removed

**Status:** Done. 0 new TS errors, 0 new test failures.

---

## Phase 2: Remaining HIGH Priority
> Issues that affect production reliability

- [ ] H5 — Lyria music generation unreliable, no fallback
  - **Decision needed:** Integrate AceStep 1.5 (local) as fallback? Or accept graceful skip?
  - Location: `src/lib/gemini.ts:148-208`

---

## Phase 3: Remaining MEDIUM Priority
> Should-fix issues for correctness and maintainability

- [ ] M2 — TypeScript `topics` type missing `topic_hash` field (`src/types/database.ts`)
- [ ] M5 — Podcast duration uses naive 150 wpm estimate → inaccurate RSS `<itunes:duration>`
- [ ] M6 — ElevenLabs cost uses raw char count, not billing unit (`src/lib/utils.ts:24`)
- [ ] M7 — lamejs 1.2.1 unmaintained (8+ years), loaded via `new Function()` hack
- [ ] M8 — `vercel.json` has no SPA rewrite rules (may not be needed for App Router)

---

## Phase 4: LOW Priority / Tech Debt
> Nice-to-have fixes, no production impact

- [ ] L1 — `estimateClaudeCost` uses Sonnet 3.5 pricing ($3/$15 per M tokens)
- [ ] L2 — `topic_hash` uses MD5 (redundant with pg_trgm dedup)
- [ ] L3 — README.md is default Next.js boilerplate
- [ ] L5 — No integration/E2E tests for pipeline
- [ ] L6 — Edge Functions have no unit tests
- [ ] L7 — HeyGen video hardcoded black background
- [ ] L8 — `N8N_ERROR_WEBHOOK_URL` silently no-ops when unset
- [ ] L10 — daily-media cron confusing indentation/scoping

---

## Phase 5: Pre-existing Test Failures
> 3 schema tests failing on master (pre-date this session)

- [ ] Fix `schemas.spec.ts` — musicGenerateSchema accepts missing mood (should fail)
- [ ] Fix `schemas.spec.ts` — carouselGenerateSchema field validation mismatch
- [ ] Fix `schemas-approval.spec.ts` — carouselGenerateSchema requires templateId (schema changed)

---

## Phase 6: Missing Features (from PRD v1.0)
> Features specified in original PRD but never built

- [ ] Popup Story modal (`/popup` quick one-off post)
- [ ] Calendar view (`/calendar` with drag-to-reschedule)
- [ ] Voice audio preview in review UI
- [ ] Email notification system (currently n8n webhook only)

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-22 | Write PRD v2.0 as-built doc before fixing | Need accurate baseline to prioritize |
| 2026-02-22 | Remove carousel publish from manual route | daily-publish cron is the single publish path — prevents double-posting |
| 2026-02-22 | Skip zero-metric analytics inserts vs disabling route | Keeps route functional for when Blotato adds metrics |
| 2026-02-22 | RSS HEAD request for file size | Lightweight, no schema migration needed, cached by s-maxage |
| TBD | Lyria fallback strategy | AceStep 1.5 local vs accept missing music |
