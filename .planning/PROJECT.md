# Content Command Center — n8n Orchestration

## What This Is

Replacing the Vercel Cron-based automation pipeline with self-hosted n8n workflows for the Content Command Center. n8n becomes the sole orchestration layer — handling content generation, media production, status monitoring, publishing, and error handling. The Next.js app becomes purely a dashboard UI + API endpoints. A single Supabase Edge Function handles all n8n callbacks with HMAC validation.

## Core Value

Reliable, observable content pipeline orchestration where every step is visible, retryable, and debuggable through n8n's visual workflow editor — replacing opaque 300-second Vercel cron jobs that fail silently.

## Requirements

### Validated

<!-- Existing capabilities confirmed working in the codebase -->

- ✓ Content generation via Claude (scripts for 6 pieces per topic) — existing API route
- ✓ Media production: TTS (ElevenLabs), avatar video (HeyGen), faceless shorts (Blotato), thumbnails (DALL-E/Gemini), carousel (Canva), music (Gemini Lyria), podcast — existing cron logic
- ✓ Publishing to 8 platforms via Blotato — existing cron logic
- ✓ Status polling for HeyGen/Blotato async jobs — existing check-status cron
- ✓ Workflow lock system preventing concurrent execution — existing
- ✓ Cost tracking per API call — existing
- ✓ Error notifications via webhook — existing notifications.ts
- ✓ Evergreen content fallback — existing
- ✓ Newsletter draft generation — existing

### Active

<!-- New scope: n8n orchestration layer -->

- [ ] 5 n8n workflow JSON files (Content Generation, Media Production, Status Monitor, Publishing, Error Handler)
- [ ] Single Supabase Edge Function for n8n callbacks (HMAC-SHA256 validated, action-based routing)
- [ ] Webhook trigger endpoint in Next.js for dashboard → n8n communication
- [ ] n8n credential configuration for all external APIs (Claude, HeyGen, Blotato, ElevenLabs, Gemini, OpenAI, Canva, Supabase)
- [ ] Manual trigger from dashboard UI (operator clicks "Generate" → fires webhook to n8n)
- [ ] n8n cron triggers replacing Vercel cron schedule (status monitor every 10min, publish hourly)
- [ ] Removal of Vercel cron routes after n8n workflows are verified working
- [ ] Error handler workflow with centralized retry logic and alerting

### Out of Scope

- Mobile app or PWA — web dashboard only
- Multi-tenant support — single operator system
- n8n cloud hosting — runs locally on Windows rig
- Custom n8n nodes — use built-in HTTP Request nodes to call existing API clients
- Migrating service client logic into n8n — n8n calls the Next.js API routes which use existing TypeScript clients

## Context

**Existing Architecture:**
- Next.js 16 App Router with 3 Vercel cron jobs (`daily-media`, `daily-publish`, `check-status`)
- All pipeline logic lives in TypeScript route handlers in `src/app/api/cron/`
- Supabase for DB + Storage + Edge Functions (Edge Functions dir exists but is empty)
- `daily-media` and `daily-publish` both use `maxDuration: 300` (5 min Vercel limit)
- Service clients are singleton wrappers in `src/lib/` (blotato.ts, heygen.ts, elevenlabs.ts, etc.)

**Why n8n:**
- Vercel cron jobs are black boxes — no visibility into which step failed
- 300-second timeout forces synchronous execution of inherently async operations
- No retry/resume capability — if a cron job fails midway, the whole thing reruns
- n8n provides visual pipeline monitoring, per-node retry, execution history, and webhook-based async handoffs

**n8n Setup:**
- Self-hosted on local Windows machine
- Calls Vercel-hosted Next.js API routes for business logic (existing TypeScript clients stay)
- Calls Supabase Edge Function for status callbacks
- Uses n8n's built-in cron for scheduling

**Codebase map:** `.planning/codebase/` (7 analysis docs from prior mapping session)

## Constraints

- **n8n hosting**: Local Windows machine — must handle n8n being offline (pipeline pauses, doesn't crash)
- **API rate limits**: HeyGen, Blotato, ElevenLabs all have rate limits — n8n must stagger calls per persona
- **Vercel timeout**: API routes called by n8n still have Vercel's function timeout — keep individual operations under 60s
- **HMAC security**: All n8n → Supabase Edge Function calls must be HMAC-SHA256 signed with N8N_WEBHOOK_SECRET
- **Budget**: ~$288-333/month for all API services combined

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Full replacement of Vercel crons | Clean architecture, n8n owns all orchestration | — Pending |
| 5 separate workflows (not mega or granular) | Balance between visibility and manageability | — Pending |
| Single Edge Function with action routing | All callbacks do validate + update DB, DRY approach | — Pending |
| n8n calls Next.js API routes (not raw APIs) | Reuse existing TypeScript service clients, don't duplicate logic | — Pending |
| Manual + scheduled triggers | Saturday planning via webhook + n8n cron for automated publishing | — Pending |

---
*Last updated: 2026-02-22 after initialization*
