# Content Command Center — Stabilization

## What This Is

Bug fix and hardening pass for the Content Command Center, an automated content production system for Faith & Harmony LLC. The app generates 6+ content pieces per topic across 8 platforms. This milestone addresses production blockers, build failures, security gaps, and reliability issues identified in the codebase audit before adding new features.

## Core Value

Every automated pipeline step completes reliably without silent failures — the operator can trust the system to produce and publish content without daily manual intervention.

## Requirements

### Validated

<!-- Existing capabilities confirmed working in the codebase -->

- ✓ Content generation via Claude (scripts for 6 pieces per topic) — existing
- ✓ Media production: TTS, avatar video, faceless shorts, thumbnails, carousel, music, podcast — existing
- ✓ Publishing to 8 platforms via Blotato — existing
- ✓ Status polling for HeyGen/Blotato async jobs — existing
- ✓ Workflow lock system preventing concurrent execution — existing
- ✓ Cost tracking per API call — existing
- ✓ Error notifications via webhook — existing
- ✓ Evergreen content fallback — existing
- ✓ Newsletter draft generation — existing
- ✓ 237 passing tests across 11 test files — existing

### Active

<!-- Stabilization scope: fix production blockers and harden reliability -->

- [ ] Build passes cleanly (currently broken by Deno types in Supabase Edge Functions)
- [ ] Podcast RSS feed serves published episodes (status promotion bug)
- [ ] Stuck topics in `content_generating` status can be recovered
- [ ] Site URL construction works correctly on Vercel deployment
- [ ] Media API routes have proper `maxDuration` set
- [ ] Daily digest email is wired up and operational
- [ ] Analytics pull endpoint has authentication
- [ ] Historical cost tracking data is consistent (`anthropic` → `claude`)
- [ ] Known bugs from CONCERNS.md are resolved
- [ ] Security gaps flagged in audit are addressed

### Out of Scope

- n8n orchestration migration — separate milestone
- Multi-brand scaling (6 personas) — future milestone
- Native platform analytics APIs — future milestone
- Frontend page tests — low priority, single operator
- Performance optimization (parallelizing check-status, daily-media) — future milestone
- Mobile app or PWA — not planned

## Context

**Current State:**
- Next.js 16 App Router + Supabase + Vercel deployment
- 3 Vercel cron jobs drive the pipeline (daily-media, daily-publish, check-status)
- Build is broken: Supabase Edge Functions (Deno) leak into `next build`
- Comprehensive codebase audit completed (`.planning/codebase/CONCERNS.md`)
- 16 modified/untracked files with uncommitted Phase 6 features

**Audit Sources:**
- `.planning/codebase/CONCERNS.md` — full bug/security/performance audit
- Test suite: 237 tests passing, but zero API route handler coverage

## Constraints

- **Vercel plan**: Function timeout limits (10s hobby, 60s pro) — must set `maxDuration` explicitly
- **Supabase free tier**: 50MB storage limit, shared project with Sentinel
- **Budget**: ~$288-333/month for all API services
- **Single operator**: No multi-user auth needed, but security basics still required
- **Backward compatible**: Fixes must not break existing working pipeline

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fix build before features | Can't deploy anything if build is broken | — Pending |
| Exclude Supabase functions from next build | Edge Functions are Deno, not Node — they don't belong in TS compilation | — Pending |
| Promote podcast status in check-status cron | Least invasive fix, follows existing status promotion pattern | — Pending |
| Add maxDuration to all heavy routes | Prevents silent Vercel timeouts on media generation | — Pending |

---
*Last updated: 2026-02-22 after stabilization milestone initialization*
