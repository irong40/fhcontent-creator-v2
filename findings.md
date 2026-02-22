# FHContent Creator v2 — Findings

## Session: 2026-02-22 — Codebase Audit & Issue Fixes

### Discovery: PRD v1.0 vs Actual Build (Major Drift)
The original PRD (Jan 2025) specifies a simpler system — 5 platforms, Blotato-only video, no podcasts. The actual build (Feb 2026) has:
- 8 platforms (added Bluesky, expanded Threads/Twitter)
- 8 content outputs per topic (added podcast + newsletter)
- 8 external APIs (added HeyGen, Canva, DALL-E 3, Gemini Lyria, ElevenLabs direct)
- Brands hierarchy above personas
- n8n Edge Function callbacks
- Evergreen content system
- Workflow locks for cron safety

**Impact:** PRD v2.0 written to document as-built state. Original PRD is now historical reference only.

### Discovery: Carousel Route Has Two Versions
The committed version on `master` (commit `6a19952`) uses **Canva + DALL-E 3** (openai + canva imports). The working tree has an alternate version using **Claude + Gemini + Blotato**. Both are valid paths — Canva autofill for production quality, Claude+Gemini for fallback.

**Impact:** My fixes were applied to the working tree version. The dual-publish removal and JSON.parse fix are relevant to both versions (Canva version didn't have the publish issue).

### Discovery: Blotato API Has No Engagement Metrics
`BlotatoPostStatus` returns only: `id, status, createdAt, publishedAt, error, platformPostId`. No views, likes, shares, saves, or comments. The analytics route was inserting all-zero rows every 10 minutes.

**Impact:** Fixed to skip zero-metric inserts. `performance_metrics` table will remain empty until either:
1. Blotato adds engagement metrics to their API
2. We integrate native platform APIs (Instagram Graph, TikTok Business, YouTube Data)

### Discovery: Cost Tracking Service Name Split
Two different service names used for Claude costs:
- `'claude'` in content/generate, topics/generate, content/regenerate, content/remix
- `'anthropic'` in media/podcast, media/carousel

The `cost_summary` view groups by service, so cost dashboards showed Claude costs split across two line items.

**Impact:** Standardized all to `'claude'`. Existing `'anthropic'` rows in production DB should be updated with a migration if cost accuracy matters historically.

### Discovery: 3 Pre-existing Test Failures
On the working tree (not master), 3 schema tests fail:
1. `schemas.spec.ts` — `musicGenerateSchema` accepts `{}` (missing required `contentPieceId`)
2. `schemas.spec.ts` — `musicGenerateSchema` accepts missing `mood` field
3. `schemas-approval.spec.ts` — `carouselGenerateSchema` no longer requires `templateId`

These are caused by schema changes in the working tree that didn't update the test expectations.

### Finding: RSS Feed Compliance Issues
1. `<enclosure length="0">` violates RSS spec (fixed — now fetches via HEAD)
2. `<itunes:duration>` estimated at 150 wpm (inaccurate for ElevenLabs speech rate)
3. `<itunes:episode>` uses UUID instead of sequential number
4. No `<itunes:image>` per episode (Apple Podcasts strongly recommends)

### Finding: Silent Failure Modes
Several components fail silently in production:
- `N8N_ERROR_WEBHOOK_URL` unset → all error notifications dropped
- Lyria music generation → returns null, pipeline skips music
- Gemini image fallback in thumbnail route → fails gracefully but no notification
- Edge Function HMAC without `N8N_WEBHOOK_SECRET` → callbacks rejected silently

### Finding: Uncommitted Work Scope
`git status` shows 16 modified files + 17 untracked files on master. This includes:
- 7 new migrations (002-007)
- 4 Edge Functions
- Analytics, newsletter, podcast routes
- Evergreen, workflow-lock libs
- Dashboard analytics component

This is a large amount of uncommitted production code.
