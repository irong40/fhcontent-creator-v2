# Architecture

**Analysis Date:** 2026-02-22

## Pattern Overview

**Overall:** Automated Content Pipeline — Next.js App Router fullstack app with a Supabase backend, three Vercel cron workers, and four Supabase Edge Functions as n8n webhook receivers.

**Key Characteristics:**
- Single Next.js app serves both the operator UI and all backend API routes
- All long-running media work (HeyGen, Blotato, ElevenLabs) is async/fire-and-forget; status is polled by the `check-status` cron
- Supabase is both the primary database and the media object store (Storage bucket `media`)
- n8n orchestrator calls back into the app via HMAC-signed Supabase Edge Functions, never directly into Next.js routes
- Workflow idempotency is enforced via a `workflow_locks` table with a 15-minute TTL

## Layers

**Middleware (Auth Gate):**
- Purpose: Block unauthenticated access to all routes except `/login`, `/api/cron/*`, and `/api/health`
- Location: `src/middleware.ts`
- Contains: Supabase SSR session check, `NextResponse.redirect` to `/login`
- Depends on: `@supabase/ssr`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Used by: Every request to the app

**UI Pages (Operator Interface):**
- Purpose: Web interface for content planning, review, approval, scheduling, and publishing
- Location: `src/app/` (page files only — no `server.ts` loaders, all data-fetching is client-side via Supabase JS)
- Contains: `page.tsx` files — all are `'use client'` components that call Supabase directly or hit API routes via `fetch`
- Depends on: Supabase browser client (`src/lib/supabase/client.ts`), API routes, shadcn/ui components
- Used by: Human operator browser sessions

**API Routes (Business Logic):**
- Purpose: All mutable operations — topic generation, content generation, media orchestration, publishing, cron jobs
- Location: `src/app/api/` organized by domain (`topics/`, `content/`, `media/`, `cron/`, `auth/`, `analytics/`, `podcast/`)
- Contains: Next.js Route Handlers (`route.ts`); all use `createAdminClient()` (service role), not the anon client
- Depends on: `src/lib/` service clients, `src/types/database.ts`, `src/lib/schemas.ts` (Zod validation)
- Used by: UI pages (via `fetch`), Vercel cron scheduler

**Cron Jobs (Automated Pipeline):**
- Purpose: Three scheduled workers that drive the automated pipeline without human intervention
- Location: `src/app/api/cron/`
- Files:
  - `daily-media/route.ts` — Runs at 6AM; submits HeyGen video jobs, Blotato faceless video jobs, generates thumbnails (DALL-E with Gemini fallback), carousel designs (Canva), background music (Gemini Lyria), and podcast audio (ElevenLabs)
  - `daily-publish/route.ts` — Runs hourly; finds topics scheduled for today, uploads media to Blotato, calls Blotato publish API per platform, logs to `published_log`, triggers evergreen fallback if nothing is scheduled
  - `check-status/route.ts` — Runs every 10 minutes; polls HeyGen and Blotato for async job completion, promotes topic/piece statuses, generates newsletter drafts for newly published topics, cleans stale workflow locks
- Depends on: Workflow lock system (`src/lib/workflow-lock.ts`), all external service clients, `validateCronSecret` from `src/app/api/cron/middleware.ts`
- Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` header automatically; validated by `src/app/api/cron/middleware.ts`

**Service Clients (External API Wrappers):**
- Purpose: Typed wrappers around every external API. Each is a singleton class instance exported from `src/lib/`.
- Location: `src/lib/`
- Files:
  - `src/lib/claude.ts` — Anthropic SDK singleton; `claude.generateContent(system, user, opts)`
  - `src/lib/blotato.ts` — Blotato social publishing + faceless video; `blotato.publishPost()`, `blotato.createVideoFromPrompt()`, `blotato.getVideoStatus()`, `blotato.getPostStatus()`
  - `src/lib/heygen.ts` — HeyGen avatar video; `heygen.createVideoFromAudio()`, `heygen.getVideoStatus()`
  - `src/lib/elevenlabs.ts` — ElevenLabs TTS; `elevenlabs.textToSpeech()`
  - `src/lib/openai.ts` — OpenAI DALL-E image generation; primary thumbnail source
  - `src/lib/gemini.ts` — Google Gemini; secondary thumbnail fallback + Lyria music generation
  - `src/lib/canva.ts` — Canva Autofill API; carousel design creation and export
  - `src/lib/email.ts` — Resend; error alert emails (fire-and-forget)
  - `src/lib/storage.ts` — Supabase Storage wrapper; `uploadAudio()`, `uploadImage()` to `media` bucket
  - `src/lib/notifications.ts` — Sends errors to n8n webhook + Resend; fire-and-forget, never throws
  - `src/lib/workflow-lock.ts` — Optimistic locking via Supabase `workflow_locks` table; `acquireLock()`, `releaseLock()`, `cleanStaleLocks()`
  - `src/lib/evergreen.ts` — LRU evergreen topic scheduling; `fillEvergreenGaps(targetDate)`
- Depends on: Environment variables, `src/lib/supabase/server.ts` (admin client)
- Used by: API routes and cron jobs only (never called from UI pages directly)

**Prompt Builders:**
- Purpose: Construct system + user prompts for every Claude generation task
- Location: `src/lib/prompts.ts`
- Functions: `buildTopicPrompt()`, `buildContentPrompt()`, `buildCarouselSlidesPrompt()`, `buildPodcastScriptPrompt()`, `buildNewsletterDraftPrompt()`, `buildRemixPrompt()`
- Pattern: All return `{ system: string; user: string }` (plus optional `maxTokens` for remix)

**Supabase Clients:**
- Location: `src/lib/supabase/`
- `client.ts` — `createClient()` — browser client using anon key, typed with `Database` generic; used in `'use client'` pages
- `server.ts` — `createClient()` — server component client using anon key + cookie jar; `createAdminClient()` — service role key, no cookie jar; used in all API routes and cron jobs

**Supabase Edge Functions (n8n Callbacks):**
- Purpose: Receive HMAC-signed callbacks from n8n workflow orchestrator and update Supabase records
- Location: `supabase/functions/`
- Runtime: Deno (separate from Next.js Node.js runtime)
- Files:
  - `n8n-topic-callback/index.ts` — Updates `topics.status` based on n8n workflow completion
  - `n8n-research-callback/index.ts` — Handles research phase callback
  - `n8n-asset-callback/index.ts` — Writes delivered asset URLs to `content_pieces` and `visual_assets`
  - `n8n-publish-callback/index.ts` — Updates publish status from n8n publishing workflow
- Shared utilities: `supabase/functions/_shared/cors.ts`, `hmac.ts` (timing-safe HMAC-SHA256 via `X-N8N-Signature` header), `supabase.ts` (Deno service client)

**Schema Validation:**
- Location: `src/lib/schemas.ts`
- Pattern: All API route inputs and Claude JSON responses validated with Zod before use
- Key schemas: `topicGenerateSchema`, `contentGenerateSchema`, `contentUpdateSchema`, `topicResponseSchema`, `contentResponseSchema`, all media/podcast/approval schemas, plus per-field remix response schemas

**Type System:**
- Location: `src/types/database.ts`
- Contains: Full Supabase database type (`Database` generic), all `Row`/`Insert`/`Update` types, domain enums (`TopicStatus`, `PieceStatus`, `PieceType`, etc.), convenience aliases (`Topic`, `Persona`, `ContentPiece`, etc.), and join types (`TopicWithPersona`)

## Data Model

**Core Hierarchy:**
```
brands (1) ──── personas (N) ──── topics (N) ──── content_pieces (N)
                                                       │
                                              audio_assets (1)
                                              visual_assets (N)
                                  │
                          podcast_episodes (N)
```

**Key Tables:**
- `brands` — Top-level brand entity (e.g., History Unveiled VA); holds `podcast_outro_cta`, `music_style`
- `personas` — Creator profiles with platform accounts, HeyGen avatar, Canva templates, voice pool, Blotato template
- `topics` — A content topic progressing through `TopicStatus` states; holds 4 `historical_points`, `voice_id`, `topic_hash` (MD5 for dedup)
- `content_pieces` — 6 pieces per topic (1 long, 4 shorts, 1 carousel); tracks script, captions, asset URLs, `published_platforms` JSONB map, `blotato_job_id`, `heygen_job_id`
- `workflow_locks` — Distributed lock table; UNIQUE on `workflow_id`, auto-expires after 15 minutes
- `published_log` — Immutable append-only publish history for evergreen dedup
- `cost_tracking` — Every API call cost logged with `service`, `operation`, `cost_usd`, token counts
- `performance_metrics` — Platform engagement data populated by analytics pull cron

**Supabase DB Functions:**
- `get_lru_voice(p_persona_id)` — Returns least-recently-used voice from persona's `voice_pool`
- `check_duplicate_topic(p_persona_id, p_title, p_threshold)` — pg_trgm similarity check against existing topics

## Data Flow

**Standard Pipeline (Topic → Published):**
1. Operator clicks "Generate Topic" on `/plan` → POST `/api/topics/generate`
2. Route calls Claude with `buildTopicPrompt()`, validates JSON with `topicResponseSchema`, inserts into `topics` (status: `draft`)
3. Operator clicks "Generate Content" → POST `/api/content/generate`
4. Route sets status `content_generating`, calls Claude with `buildContentPrompt()`, inserts 6 `content_pieces` (status: `ready`), sets topic status `content_ready`
5. `daily-media` cron (6AM) picks up `content_ready` topics → submits HeyGen/Blotato video jobs, generates thumbnails, carousel, music, podcast
6. `check-status` cron (every 10min) polls HeyGen and Blotato for completion; updates `video_url`, sets piece status `produced`
7. Operator reviews at `/review/[topicId]` → edits scripts/captions → approves → schedules date
8. `daily-publish` cron (hourly) finds scheduled topics for today → uploads media to Blotato → calls publish API per platform → logs to `published_log`
9. `check-status` cron polls Blotato post statuses → updates `published_platforms` per piece → promotes topic to `published`
10. `check-status` auto-generates newsletter draft via Claude for newly published topics (if persona has `newsletter_cta`)

**n8n Callback Flow:**
1. Next.js API route calls external service or n8n triggers independently
2. n8n workflow completes → sends HMAC-signed POST to Supabase Edge Function
3. Edge Function validates `X-N8N-Signature`, updates relevant table row

**Evergreen Fallback:**
1. `daily-publish` finds no scheduled topics for today
2. Calls `fillEvergreenGaps()` in `src/lib/evergreen.ts`
3. For each active persona lacking a scheduled topic, selects least-recently-published `is_evergreen=true` topic
4. Re-sets that topic's `publish_date` to today and `status` to `scheduled`
5. `daily-publish` re-queries and publishes the now-scheduled evergreen topics

**State Management (Client UI):**
- All UI pages use the Supabase browser client directly for reads (no server-side data loading via `getServerSideProps` or RSC loaders)
- Mutations go through Next.js API routes via `fetch()`, not direct Supabase writes (except `topics.voice_id` change in review page)
- Local React state with `useState`/`useCallback`; dirty-tracking for unsaved edits on review page

## Key Abstractions

**TopicStatus State Machine:**
- Values: `draft` → `topics_approved` → `content_generating` → `content_ready` → `approved` → `scheduled` → `publishing` → `partially_published` | `published` | `failed`
- Defined: `src/types/database.ts` as `TopicStatus` union type
- Transitions enforced: in API route guards (e.g., approve rejects unless `content_ready`)

**PieceType Enum:**
- Values: `long`, `short_1`, `short_2`, `short_3`, `short_4`, `carousel`
- Routing table in `daily-media`: `HEYGEN_PIECE_TYPES = ['long']` (avatar video), `BLOTATO_PIECE_TYPES = ['short_1', 'short_2', 'short_3', 'short_4']` (faceless video)
- `carousel` handled separately via Canva Autofill

**ContentChannel Enum:**
- Values: `social`, `podcast`, `newsletter`
- Allows `content_pieces` table to hold non-social content (newsletter drafts stored as `piece_order: 7` with `content_channel: 'newsletter'`)

**Workflow Lock Pattern:**
- Used by: `daily-media` and `daily-publish` crons
- Pattern:
  ```typescript
  const lockToken = await acquireLock('daily-media');
  if (!lockToken) return NextResponse.json({ error: 'Workflow already running' }, { status: 409 });
  try { /* work */ } finally { await releaseLock('daily-media', lockToken); }
  ```

## Entry Points

**Browser UI:**
- Location: `src/app/layout.tsx`
- Auth check: reads Supabase session in layout; shows `SignOutButton` if user present
- Triggers: All page routes render inside this layout with sticky nav

**Next.js Middleware:**
- Location: `src/middleware.ts`
- Triggers: Every request matching `/((?!_next/static|_next/image|favicon.ico|.*\.(svg|png|jpg|jpeg|gif|webp)$).*)`
- Responsibilities: Auth gate; allow-lists `/login`, `/api/cron/*`, `/api/health`

**Vercel Cron Scheduler:**
- Location: `vercel.json` (3 cron entries)
- Triggers: Vercel Platform calls GET endpoints with `Authorization: Bearer <CRON_SECRET>`
- Schedule: `daily-media` at 6AM, `daily-publish` hourly, `check-status` every 10 minutes

**n8n Webhook Receivers (Supabase Edge Functions):**
- Location: `supabase/functions/`
- Triggers: n8n sends HMAC-signed POST after workflow step completion
- Auth: `X-N8N-Signature` header validated via HMAC-SHA256 using `N8N_WEBHOOK_SECRET`

## Error Handling

**Strategy:** Try/catch in all API routes; return `{ success: false, error: string }` JSON with appropriate HTTP status. Non-blocking fire-and-forget notification to n8n webhook and Resend email on pipeline failures.

**Patterns:**
- API routes: `try/catch` returning `{ success: false, error: message }` at status 500; specific validation errors at 400/404
- Claude JSON parse failures: Status set back to `draft`; return 502 with `{ error: 'AI returned invalid JSON' }`
- Media job failures: Retry count incremented on piece; after 3 retries status set to `failed`, `notifyError()` called
- Cron failures: Individual topic errors collected in array, returned in response; `notifyError()` called when piece error count >= 3
- Notification (`src/lib/notifications.ts`): Fire-and-forget, swallows all errors silently to prevent blocking pipeline

## Cross-Cutting Concerns

**Logging:** `console.error()` and `console.warn()` only; no structured logging framework. Vercel captures stdout/stderr.

**Validation:** All API route bodies validated with Zod schemas from `src/lib/schemas.ts` before any business logic. Claude JSON responses are also validated with Zod before database writes.

**Authentication:**
- UI routes: Supabase session via `@supabase/ssr` cookie-based middleware
- Cron routes: `Authorization: Bearer <CRON_SECRET>` header; dev bypass when env var absent
- Edge Functions: HMAC-SHA256 `X-N8N-Signature` header with timing-safe comparison
- All API routes use `createAdminClient()` (service role key) — no RLS enforcement at the API layer

**Cost Tracking:** Every external AI API call inserts a row into `cost_tracking` with `service`, `operation`, `cost_usd`, and token counts. Costs are aggregated by `cost_summary` Supabase view, displayed on dashboard.

---

*Architecture analysis: 2026-02-22*
