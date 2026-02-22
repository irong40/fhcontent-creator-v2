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

## Phase 3: Remaining MEDIUM Priority (COMPLETED)
> Should-fix issues for correctness and maintainability

- [x] M2 — TypeScript `topics` type already has `topic_hash` field (was fixed in earlier work)
- [x] M5 — Podcast duration now derived from MP3 buffer size (128kbps = 16000 bytes/sec) instead of 150 wpm guess
- [x] M6 — ElevenLabs cost function updated with tier-aware pricing ($0.30 Starter / $0.18 Scale)
- [x] M7 — Replaced `lamejs` 1.2.1 with `@breezystack/lamejs` 1.2.7 (maintained, proper ESM, no `new Function()` hack)
- [x] M8 — Confirmed non-issue: Next.js App Router handles routing server-side, no SPA rewrites needed

**Status:** Done. 0 new TS errors, 0 new test failures.

---

## Phase 4: LOW Priority / Tech Debt (COMPLETED)
> Nice-to-have fixes, no production impact

- [x] L1 — Pricing is correct ($3/$15 same for Sonnet 3.5 through 4.5)
- [x] L2 — Accepted: MD5 is defense-in-depth alongside pg_trgm (no change needed)
- [ ] L3 — README.md is default Next.js boilerplate (deferred — no production impact)
- [ ] L5 — No integration/E2E tests for pipeline (deferred — significant effort)
- [ ] L6 — Edge Functions have no unit tests (deferred — requires Deno test setup)
- [x] L7 — HeyGen background now configurable via options param (default: #1a1a2e)
- [x] L8 — `notifyError` logs warning on first call when `N8N_ERROR_WEBHOOK_URL` unset
- [x] L10 — daily-media cron indentation fixed (inner loop properly nested under persona loop)

**Status:** Done (actionable items). L3/L5/L6 deferred as out-of-scope for stabilization.

---

## Phase 5: Pre-existing Test Failures (COMPLETED)
> Tests updated to match current schema (fields intentionally made optional)

- [x] Fix `schemas.spec.ts` — videoGenerateSchema: avatarId/audioUrl/blotatoTemplateId are optional
- [x] Fix `schemas.spec.ts` — carouselGenerateSchema: templateId is optional
- [x] Fix `schemas-approval.spec.ts` — carouselGenerateSchema: only contentPieceId is required

**Status:** Done. 237 tests passing, 0 failures.

---

## Phase 6: Missing Features (from PRD v1.0) — COMPLETED
> Features specified in original PRD but never built. All 4 sub-phases implemented in single batch.

### Phase 6A: Voice Audio Preview in Review UI
> Lowest effort, highest value — users can hear TTS before committing to full video generation
>
> **Why first:** Review page already has `<audio>` for video pieces (`review/[topicId]/page.tsx:446-449`). This extends the pattern to all content and adds a lightweight "preview" mode that generates a short TTS sample instead of the full track.

**Current state:** Audio preview exists for video pieces only — shows `<audio>` when `audio_assets` row exists with `audio_url`. No preview for carousel captions, podcast scripts, or pre-TTS script review.

**Implementation:**

- [ ] **6A.1: TTS Preview API endpoint**
  - New file: `src/app/api/media/voice-preview/route.ts`
  - POST body: `{ text: string, voiceId: string }` (max 500 chars)
  - Calls ElevenLabs with first 500 chars of script (capped to ~30 sec audio)
  - Returns `{ audioUrl: string }` — uploaded to Supabase Storage `audio-previews/` bucket (24h TTL via lifecycle policy)
  - Cost tracking: log as `elevenlabs-preview` service (separate from full TTS)
  - No DB persistence — preview URLs are ephemeral

- [ ] **6A.2: Preview button in Review page**
  - Add "Preview Voice" button next to voice selector in `review/[topicId]/page.tsx`
  - Shows inline `<audio>` player with the preview clip
  - Available on ALL tabs (long, short_1-4, carousel) — not just video pieces
  - Uses selected `voiceId` from the voice dropdown (already exists in review page)
  - Sends first 500 chars of `piece.script` (or `piece.caption_long` for carousel)
  - Loading state with "Previewing..." spinner
  - Clears preview audio when switching tabs or changing voice

- [ ] **6A.3: Podcast script preview**
  - In review page, add a "Podcast" tab alongside existing piece tabs
  - Fetches `podcast_episodes` for this topic (already exists in DB, not shown in review UI)
  - Shows podcast script with word count + estimated duration
  - "Preview Voice" button sends first 500 chars of podcast script
  - "Generate Podcast" button (calls existing `/api/media/podcast`)

**Files to modify:**
| File | Change |
|------|--------|
| `src/app/api/media/voice-preview/route.ts` | **NEW** — lightweight TTS preview endpoint |
| `src/app/review/[topicId]/page.tsx` | Add preview button, podcast tab, audio player |
| `src/lib/schemas.ts` | Add `voicePreviewSchema` (text + voiceId) |

**Dependencies:** None. Uses existing ElevenLabs client, voice selector, audio player pattern.
**Estimated effort:** ~2 hours

---

### Phase 6B: Popup Story / Quick Post Modal
> Quick one-off post bypassing the full topic→content→review pipeline
>
> **Why second:** Independent of calendar. Uses existing Blotato publish + Claude content gen APIs. The dialog component already exists in shadcn/ui.

**Current state:** Every post must go through: generate topic → generate content (6 pieces) → review → approve → schedule → cron publishes. No way to quickly post a timely/reactive piece.

**Implementation:**

- [ ] **6B.1: Quick Post API endpoint**
  - New file: `src/app/api/content/quick-post/route.ts`
  - POST body: `{ personaId, text: string, platforms: string[], mediaType?: 'text' | 'image' | 'carousel', imagePrompt?: string }`
  - Flow:
    1. If `text` provided as-is → use directly (user wrote the copy)
    2. If `text` is a prompt/idea → call Claude to expand into platform-ready caption
    3. If `mediaType === 'image'` → generate thumbnail via DALL-E 3
    4. Publish immediately via Blotato to selected platforms
    5. Log to `published_log` for duplicate detection
    6. Log cost to `cost_tracking`
  - Returns `{ success: boolean, results: { platform, postId, error }[] }`

- [ ] **6B.2: Quick Post dialog component**
  - New file: `src/components/quick-post-dialog.tsx`
  - Shadcn `<Dialog>` modal triggered from nav bar or Plan page
  - Fields:
    - Persona selector (dropdown, defaults to active persona)
    - Text area (caption/idea — placeholder: "What's on your mind?")
    - Toggle: "Use as-is" vs "Expand with AI" (default: expand)
    - Platform checkboxes (populated from persona's `platform_accounts`)
    - Optional: "Add image" toggle → shows image prompt input
  - Submit button: "Post Now" with loading state
  - Success: toast with platform results, close dialog
  - Error: toast with error, keep dialog open

- [ ] **6B.3: Trigger button in nav + Plan page**
  - Add "Quick Post" button in `nav-links.tsx` (icon + label, or just label)
  - Add "Quick Post" card/button on Plan page alongside "Generate Topics"
  - Both open the same `<QuickPostDialog />`

**Files to modify:**
| File | Change |
|------|--------|
| `src/app/api/content/quick-post/route.ts` | **NEW** — quick post endpoint |
| `src/components/quick-post-dialog.tsx` | **NEW** — dialog component |
| `src/components/nav-links.tsx` | Add Quick Post trigger button |
| `src/app/plan/page.tsx` | Add Quick Post card |
| `src/lib/schemas.ts` | Add `quickPostSchema` |

**Dependencies:** None. Uses existing Blotato client, Claude client, DALL-E client.
**Estimated effort:** ~3 hours

---

### Phase 6C: Calendar View
> Visual scheduling with drag-to-reschedule
>
> **Why third:** Needs the most UI work (calendar grid, drag-and-drop). Touches existing topic scheduling flow. Best done after quick post (6B) since quick posts should also appear on calendar.

**Current state:** Plan page shows topics in a flat list sorted by `created_at`. Schedule dates are set in the review page via date/time inputs. No visual overview of what's publishing when.

**Implementation:**

- [ ] **6C.1: Calendar page route**
  - New file: `src/app/calendar/page.tsx`
  - Month view grid (7 columns × 5-6 rows)
  - Header: month/year with prev/next arrows, persona filter
  - Each day cell shows topic cards (colored by status)
  - Topic cards show: title (truncated), status badge, piece count
  - Click card → navigate to `/review/[topicId]`
  - Empty day slots are droppable targets

- [ ] **6C.2: Drag-and-drop rescheduling**
  - Use `@dnd-kit/core` + `@dnd-kit/sortable` (React 19 compatible, lightweight)
  - Drag a topic card from one day to another → calls `/api/topics/[id]/schedule` with new date
  - Visual feedback: ghost card on drag, highlight drop target
  - Only draggable for statuses: `content_ready`, `approved`, `scheduled` (not published/publishing)
  - Optimistic update → revert on API error

- [ ] **6C.3: Calendar topics API**
  - New file: `src/app/api/topics/calendar/route.ts`
  - GET `?month=2026-02&persona=<id>`
  - Returns topics with `publish_date` in the requested month range
  - Includes: id, title, status, publish_date, persona_id, piece counts (via count query)
  - Lightweight — no scripts/captions, just metadata for calendar cards

- [ ] **6C.4: Navigation link**
  - Add `{ href: '/calendar', label: 'Calendar' }` to `nav-links.tsx`
  - Position: after "Plan", before "Costs"

**Files to modify:**
| File | Change |
|------|--------|
| `src/app/calendar/page.tsx` | **NEW** — calendar view |
| `src/app/api/topics/calendar/route.ts` | **NEW** — month query endpoint |
| `src/components/nav-links.tsx` | Add Calendar link |
| `package.json` | Add `@dnd-kit/core` + `@dnd-kit/sortable` |

**Dependencies:** None for basic view. Drag-and-drop uses existing `/api/topics/[id]/schedule` endpoint.
**Estimated effort:** ~4-5 hours

---

### Phase 6D: Email Notification System
> Replace fire-and-forget n8n webhook with structured email alerts
>
> **Why last:** Lowest priority — n8n webhook already works for error notifications. Email adds polish but isn't blocking any workflow.

**Current state:** `notifyError()` in `lib/notifications.ts` sends JSON to an n8n webhook URL. No email delivery. No success notifications. No daily digest.

**Implementation options (choose one):**

**Option A: Resend (recommended)**
- Add `resend` npm package + `RESEND_API_KEY` env var
- Simple API, generous free tier (100 emails/day), no SMTP config
- Send from `noreply@faithharmony.com` (or verified domain)

**Option B: Supabase Edge Function + Resend**
- Keep notification logic server-side in Edge Function
- Triggered by database webhook on topic status changes

- [ ] **6D.1: Email service module**
  - New file: `src/lib/email.ts`
  - `sendEmail({ to, subject, html })` — wraps Resend SDK
  - Templates: error alert, daily digest, publish success
  - Graceful fallback: if `RESEND_API_KEY` not set, log + skip (same pattern as n8n webhook)

- [ ] **6D.2: Notification triggers**
  - Modify `lib/notifications.ts` — send email alongside webhook
  - Add `notifySuccess()` — called after successful publish
  - Add `sendDailyDigest()` — summary of day's publishes, costs, errors
  - Trigger digest from `daily-publish` cron at end of day (11 PM run)

- [ ] **6D.3: Email preferences**
  - Add `notification_email` column to `brands` table (migration 006)
  - Add email field to persona edit page
  - Or: use a simple env var `NOTIFICATION_EMAIL` for v1

**Files to modify:**
| File | Change |
|------|--------|
| `src/lib/email.ts` | **NEW** — Resend email wrapper |
| `src/lib/notifications.ts` | Add email delivery alongside webhook |
| `.env.example` | Add `RESEND_API_KEY`, `NOTIFICATION_EMAIL` |
| `package.json` | Add `resend` |

**Dependencies:** Resend account + API key. DNS verification for custom domain (optional).
**Estimated effort:** ~2 hours

---

### Phase 6 Summary

| Sub-phase | Feature | Effort | Priority | Dependencies |
|-----------|---------|--------|----------|-------------|
| 6A | Voice audio preview | ~2h | HIGH | None |
| 6B | Quick Post modal | ~3h | HIGH | None |
| 6C | Calendar view | ~4-5h | MEDIUM | 6B (optional — quick posts on calendar) |
| 6D | Email notifications | ~2h | LOW | Resend account |

**Total estimated effort:** ~11-12 hours
**Recommended order:** 6A → 6B → 6C → 6D (can parallelize 6A+6B if desired)

**Status:** COMPLETED. All 4 sub-phases implemented. 237/237 tests passing, 0 new TS errors.
- Calendar uses native HTML5 drag-and-drop (no @dnd-kit needed — avoided dependency)
- Email uses Resend REST API directly (no `resend` npm package needed — avoided dependency)

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-22 | Write PRD v2.0 as-built doc before fixing | Need accurate baseline to prioritize |
| 2026-02-22 | Remove carousel publish from manual route | daily-publish cron is the single publish path — prevents double-posting |
| 2026-02-22 | Skip zero-metric analytics inserts vs disabling route | Keeps route functional for when Blotato adds metrics |
| 2026-02-22 | RSS HEAD request for file size | Lightweight, no schema migration needed, cached by s-maxage |
| TBD | Lyria fallback strategy | AceStep 1.5 local vs accept missing music |
