# Content Command Center — Faith & Harmony LLC
## Product Requirements Document v2.0

**Version:** 2.0
**Date:** February 22, 2026
**Status:** As-Built Documentation + Known Issues
**Stack:** Next.js 16 / React 19 / TypeScript 5 / Supabase / Vercel / 8 External APIs

---

## Executive Summary

Automated content production system for Faith & Harmony LLC. One historical topic generates 8+ content pieces — long-form avatar video, 4 short faceless videos, carousel, podcast episode, and newsletter draft — published across 8 social platforms automatically via a "Saturday planning → automated execution" workflow.

### The Math (Actual)
- 1 Topic → 8 Content Outputs (6 social pieces + 1 podcast + 1 newsletter draft)
- 1 Topic → 30+ Platform Posts (6 pieces x 1-6 platforms each)
- 7 Topics/Week → 56 Content Outputs → 210+ Platform Posts
- Estimated Cost: ~$288-333/month (~$72-83/week)

### Lead Brand
**History Unveiled VA** — African American history in Virginia, Dr. Imani Carter persona. 6 total brands planned (phased launch).

---

## System Architecture

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| UI | React | 19.2.3 |
| Language | TypeScript | 5.x (strict) |
| Styling | Tailwind CSS v4 + Shadcn/ui (Radix) | v4 + 1.4.3 |
| Database | Supabase (PostgreSQL + Auth + Storage + Edge Functions) | — |
| AI Content | Claude (Anthropic SDK) | claude-sonnet-4-5-20250929 |
| AI Images | OpenAI DALL-E 3 (primary), Gemini Imagen (fallback) | dall-e-3 / gemini-2.0-flash-exp |
| AI Music | Google Lyria RealTime (experimental) | lyria-realtime-exp |
| Avatar Video | HeyGen | v2 API |
| Faceless Video | Blotato | v2 API |
| Carousel Design | Canva Connect API + Blotato (publish) | REST v1 |
| Voice/TTS | ElevenLabs | eleven_multilingual_v2 |
| Publishing | Blotato (8 platforms) | v2 API |
| Error Notifications | n8n webhook (self-hosted) | — |
| Async Callbacks | Supabase Edge Functions (Deno) | — |
| Hosting | Vercel (serverless + cron) | — |
| Testing | Vitest | 4.0.18 |

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SATURDAY PLANNING SESSION                       │
│  Select Persona → Generate Topics → Review → Generate Content       │
│  → Review Scripts → Approve → Schedule                               │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AUTOMATED DAILY PIPELINE                         │
│                                                                      │
│  ┌──────────┐   ┌──────────┐   ┌─────────────┐   ┌──────────────┐  │
│  │ 6 AM     │   │ Hourly   │   │ Every 10min │   │ On-demand    │  │
│  │ daily-   │──→│ daily-   │──→│ check-      │──→│ Newsletter + │  │
│  │ media    │   │ publish  │   │ status      │   │ Podcast gen  │  │
│  └──────────┘   └──────────┘   └─────────────┘   └──────────────┘  │
│       │              │               │                               │
│  TTS + HeyGen   Blotato API    Poll HeyGen +                       │
│  + DALL-E 3     8 platforms    Blotato status                       │
│  + Canva                       Promote topics                       │
│  + Lyria music                 Clean stale locks                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Model Hierarchy

```
brands
  └── personas
        └── topics (weekly, 7 per batch)
              ├── content_pieces (6 per topic: long, short_1-4, carousel)
              │     ├── audio_assets (ElevenLabs TTS)
              │     └── visual_assets (thumbnails, carousel images)
              ├── podcast_episodes (1 per topic per brand)
              └── published_log (per-platform publish records)
```

---

## User Workflow

### Saturday Planning Session (2-3 hours)

```
Step 1: Select Persona via PersonaSwitcher           (30 seconds)
    ↓
Step 2: Click "Generate Topics" on /plan             (2 min wait — Claude)
    ↓
Step 3: Review topics, check duplicates              (15-20 min)
    ↓
Step 4: Click "Generate Content" per topic           (5-10 min wait — Claude)
    ↓
Step 5: Review/edit scripts + captions on /review    (60-90 min)
    ↓
Step 6: Approve topics, assign dates, schedule       (5 min)
    ↓
Done. Three cron jobs handle the rest automatically.
```

### Automated Weekday Pipeline

| Time | Cron Job | Action |
|------|----------|--------|
| 6:00 AM | `daily-media` | Generate TTS audio, HeyGen avatar video, Blotato faceless video, DALL-E thumbnails, Canva carousels, Lyria music, podcast episodes |
| Every hour | `daily-publish` | Find scheduled topics for today, publish all pieces to 8 platforms via Blotato. Falls back to evergreen content if queue empty. |
| Every 10 min | `check-status` | Poll HeyGen + Blotato async jobs, promote topic statuses, auto-generate newsletter drafts, clean stale workflow locks |

---

## Content Structure

### Per Topic (8 Outputs)

| # | Type | Duration/Size | Generation | Distribution |
|---|------|--------------|------------|-------------|
| 1 | Long-form avatar video | 2-4 min | ElevenLabs TTS → HeyGen avatar | TikTok, Instagram, YouTube |
| 2 | Short faceless video 1 | 30 sec | Blotato from template | TikTok, IG, YT, Threads, X, Bluesky |
| 3 | Short faceless video 2 | 30 sec | Blotato from template | TikTok, IG, YT, Threads, X, Bluesky |
| 4 | Short faceless video 3 | 30 sec | Blotato from template | TikTok, IG, YT, Threads, X, Bluesky |
| 5 | Short faceless video 4 | 30 sec | Blotato from template | TikTok, IG, YT, Threads, X, Bluesky |
| 6 | Carousel | 8-10 slides | Canva autofill + AI images | Instagram |
| 7 | Podcast episode | 20-35 min | Claude script → ElevenLabs TTS | RSS feed (Apple, Spotify) |
| 8 | Newsletter draft | ~5 min read | Claude from long-form script | Substack (manual review) |

### Platform Distribution (8 Platforms)

| Platform | Account | Long | Shorts | Carousel | Podcast |
|----------|---------|------|--------|----------|---------|
| TikTok | @faithharmony | Yes | Yes | — | — |
| Instagram | @faithharmony4045 | Yes (Reel) | Yes (Reel) | Yes | — |
| YouTube | @TheyNeverToldUs | Yes | Yes (Short) | — | — |
| Threads | @HistoryUnveiledVA | — | Yes | — | — |
| X (Twitter) | @APiercea45 | — | Yes | — | — |
| Bluesky | TBD | — | Yes | — | — |
| Apple Podcasts | via RSS | — | — | — | Yes |
| Spotify | via RSS | — | — | — | Yes |

---

## Database Schema (7 Migrations Applied)

### Tables (14)

#### `brands`
Parent entity for multi-brand support.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | TEXT | "History Unveiled VA" |
| vertical | TEXT | Content vertical/niche |
| platform_accounts | JSONB | `{ tiktok: "5294", instagram: "4346", ... }` |
| cta_template | TEXT | Call-to-action for content |
| music_style | TEXT | Brand music preference |
| podcast_outro_cta | TEXT | Podcast outro CTA text |
| is_active | BOOLEAN | |
| created_at, updated_at | TIMESTAMPTZ | |

#### `personas`
Creator personas belonging to a brand.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| brand_id | UUID FK→brands | |
| name | TEXT | "Dr. Imani Carter" |
| brand | TEXT | Legacy field — brand name |
| tagline | TEXT | |
| expertise_areas | TEXT[] | Topics AI draws from |
| voice_style | TEXT | Tone/personality guidance |
| content_guidelines | TEXT | Do's and don'ts |
| platform_accounts | JSONB | Blotato account IDs per platform |
| voice_pool | TEXT[] | ElevenLabs voice IDs |
| profile_image_url | TEXT | |
| heygen_avatar_id | TEXT | HeyGen avatar for long-form video |
| heygen_voice_id | TEXT | |
| canva_brand_kit_id | TEXT | |
| canva_carousel_template_id | TEXT | Canva template for carousel autofill |
| blotato_template_id | TEXT | Blotato template for faceless shorts |
| newsletter_url | TEXT | Substack URL |
| newsletter_cta | TEXT | Newsletter CTA appended to captions |
| is_active | BOOLEAN | |

#### `topics`
Weekly topic containers with full lifecycle status tracking.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| persona_id | UUID FK→personas CASCADE | |
| title | TEXT | |
| hook | TEXT | Attention-grabbing opener |
| historical_points | JSONB | Array of 4 `{ point, claim, source, year }` |
| topic_hash | TEXT | MD5 of lowercased title |
| voice_id | TEXT | Assigned via LRU rotation |
| thumbnail_prompt | TEXT | |
| publish_date | DATE | |
| publish_time | TIME | Default 09:00 |
| is_evergreen | BOOLEAN | Default false — eligible for auto-rescheduling |
| status | TEXT | See Topic Status Machine below |
| error_message | TEXT | |
| retry_count | INT | Default 0 |
| Timestamps | TIMESTAMPTZ | created_at, topics_approved_at, content_ready_at, approved_at, published_at |

**Topic Status Machine:**
```
draft → topics_approved → content_generating → content_ready → approved → scheduled
    → publishing → published | partially_published | failed
```

#### `content_pieces`
6 pieces per topic with per-platform publish tracking.
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| topic_id | UUID FK→topics CASCADE | |
| piece_type | TEXT | `long`, `short_1`, `short_2`, `short_3`, `short_4`, `carousel` |
| piece_order | INT | 1-6 |
| script | TEXT | Video script or carousel combined text |
| caption_long | TEXT | ≤2200 chars (IG, TikTok, YouTube) |
| caption_short | TEXT | ≤280 chars (X/Twitter) |
| thumbnail_prompt | TEXT | |
| thumbnail_url | TEXT | |
| carousel_slides | JSONB | `[{ slide, text, imagePrompt }]` |
| music_track | TEXT | Mood string or Supabase storage URL |
| content_hash | TEXT | Unique, nullable |
| content_channel | TEXT | `social`, `podcast`, `newsletter` |
| hook_performance | TEXT | |
| blotato_job_id | TEXT | Faceless video job |
| blotato_status | TEXT | `pending`, `processing`, `done`, `failed` |
| heygen_job_id | TEXT | Avatar video job |
| heygen_status | TEXT | |
| canva_design_id | TEXT | |
| video_url | TEXT | Final video URL |
| carousel_url | TEXT | JSON string of export URLs (multi-slide) |
| published_platforms | JSONB | `{ platform: { status, post_id, published_at, error } }` |
| status | TEXT | See Piece Status Machine below |
| error_message | TEXT | |
| retry_count | INT | |
| Timestamps | TIMESTAMPTZ | created_at, produced_at, published_at |

**Piece Status Machine:**
```
pending → generating → ready → processing → produced → publishing → published | failed
```

#### `podcast_episodes`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| topic_id | UUID FK | |
| brand_id | UUID FK | |
| persona_id | UUID FK | |
| title | TEXT | |
| script | TEXT | 3000-5000 word podcast script |
| audio_url | TEXT | Supabase storage URL |
| duration_seconds | INTEGER | Estimated at ~150 wpm |
| rss_guid | TEXT | UNIQUE, auto-generated |
| status | TEXT | `draft`, `generating`, `ready`, `published`, `error` |

#### `voices`
ElevenLabs voice rotation pool with LRU tracking.

#### `audio_assets`
ElevenLabs TTS results linked to content pieces.

#### `visual_assets`
Thumbnails and carousel images linked to content pieces.

#### `published_log`
Historical record for duplicate detection (pg_trgm similarity).

#### `cost_tracking`
Per-API-call cost logging. View: `cost_summary` (daily aggregation by service).

#### `performance_metrics`
Platform engagement snapshots (views, likes, shares, saves, comments).

#### `content_ideas`
Pre-pipeline topic backlog per brand.

#### `workflow_locks`
Prevents concurrent cron execution (15-min TTL, UUID tokens).

### Database Functions
- `get_lru_voice(persona_id)` — Least recently used voice from persona's pool
- `check_duplicate_topic(persona_id, title, threshold=0.8)` — pg_trgm similarity check against published_log

### Extensions
- `pg_trgm` — Text similarity for duplicate detection

---

## API Routes (21 Endpoints)

### Authentication
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/auth/callback` | Supabase OAuth PKCE code exchange |

### Health
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Ping all 7 external services, return latency + status |

### Topics (4 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/topics/generate` | Generate N topics via Claude with duplicate detection |
| POST | `/api/topics/[id]/approve` | Approve topic (requires all pieces ready) |
| POST | `/api/topics/[id]/schedule` | Set publish date (must be today or future) |
| POST | `/api/topics/[id]/publish` | Manual publish trigger (force flag for re-publish) |

### Content (5 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/content/generate` | Generate 6 pieces for a topic via Claude |
| PATCH | `/api/content/[id]` | Manual edit of script/captions/slides |
| POST | `/api/content/[id]/regenerate` | Re-generate all fields for one piece |
| POST | `/api/content/[id]/remix` | Re-generate single field (script, caption, etc.) |
| POST | `/api/content/newsletter-draft` | Generate newsletter draft (not persisted) |

### Media Generation (6 endpoints)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/media/voice` | ElevenLabs TTS → Supabase Storage |
| POST | `/api/media/video` | HeyGen (long) or Blotato (shorts) video |
| POST | `/api/media/thumbnail` | DALL-E 3 (primary) / Gemini (fallback) |
| POST | `/api/media/carousel` | Claude slides + Gemini images + optional Blotato publish |
| POST | `/api/media/music` | Gemini Lyria instrumental music bed |
| POST | `/api/media/podcast` | Claude script expansion + ElevenLabs TTS |

### Analytics
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/analytics/pull` | Poll Blotato for engagement metrics |

### RSS
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/podcast/rss/[brandId]` | RSS 2.0 + iTunes XML podcast feed |

### Cron Jobs (3 endpoints)
| Method | Path | Schedule | Purpose |
|--------|------|----------|---------|
| GET | `/api/cron/daily-media` | 6 AM daily | Generate all media assets |
| GET | `/api/cron/daily-publish` | Hourly | Publish to 8 platforms |
| GET | `/api/cron/check-status` | Every 10 min | Poll async jobs, promote statuses |

---

## Frontend Pages (8 Routes)

| Route | Purpose | Key Features |
|-------|---------|-------------|
| `/` | Dashboard | Stats cards, per-persona metrics, cost summary, top posts, API health link |
| `/login` | Authentication | Email/password via Supabase Auth |
| `/plan` | Weekly planning | PersonaSwitcher, topic generation, content generation triggers, status badges |
| `/review/[topicId]` | Content review | Tabbed per-piece view, inline script/caption editing, media generation buttons, approve/schedule/publish |
| `/personas` | Persona list | Cards with platform/voice counts, link to edit |
| `/personas/new` | Create persona | Name, brand, AI settings, platform IDs, HeyGen/Canva/Blotato IDs |
| `/personas/[id]/edit` | Edit persona | Same fields + delete |
| `/costs` | Cost tracking | Total spend, by service, by persona, daily trend, 7d/30d/all filters |

### Navigation
Header: Logo → Plan / Costs / Personas / API Status

### Auth Middleware
All routes except `/login`, `/api/cron/*`, `/api/health` require authenticated Supabase session.

---

## Supabase Edge Functions (4 n8n Callbacks)

All validated via HMAC-SHA256 (`X-N8N-Signature` header + `N8N_WEBHOOK_SECRET`).

| Function | Trigger | Action |
|----------|---------|--------|
| `n8n-topic-callback` | n8n topic workflow step | Update topic status + timestamps |
| `n8n-research-callback` | n8n web research step | Merge sources into topic's historical_points |
| `n8n-asset-callback` | n8n asset delivery | Update content_pieces with asset URLs |
| `n8n-publish-callback` | n8n platform publish | Update published_platforms JSONB + published_log |

---

## Environment Variables (17)

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase admin key (server) |
| `ANTHROPIC_API_KEY` | Yes | Claude content generation |
| `GEMINI_API_KEY` | Yes | Gemini images + Lyria music |
| `OPENAI_API_KEY` | Yes | DALL-E 3 thumbnails |
| `BLOTATO_API_KEY` | Yes | Video creation + 8-platform publishing |
| `HEYGEN_API_KEY` | Yes | Avatar video generation |
| `ELEVENLABS_API_KEY` | Yes | Text-to-speech + podcast narration |
| `CANVA_API_KEY` | Yes | Carousel design autofill |
| `CRON_SECRET` | Yes | Vercel cron endpoint auth |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Base URL for RSS feed + internal API calls |
| `N8N_WEBHOOK_SECRET` | Yes (Edge Fns) | HMAC validation for n8n callbacks |
| `N8N_ERROR_WEBHOOK_URL` | Recommended | Error notification webhook |
| `VERCEL_URL` | Auto-set | Vercel deployment URL (fallback for SITE_URL) |
| `VERCEL_ENV` | Auto-set | Environment indicator |
| `SUPABASE_PROJECT_REF` | Optional | For CLI operations |

---

## Cost Estimates

### Per-Operation Costs

| Operation | Service | Est. Cost |
|-----------|---------|-----------|
| Generate 7 topics | Claude | $0.15 |
| Generate content (per topic) | Claude | $0.10 |
| Podcast script expansion | Claude | $0.08 |
| Newsletter draft | Claude | $0.05 |
| Long-form TTS (2-4 min) | ElevenLabs | $0.30-0.60 |
| Podcast TTS (20-35 min) | ElevenLabs | $3.00-5.00 |
| Avatar video (long) | HeyGen | $0.25 |
| Faceless video (short) | Blotato | $0.10 |
| Thumbnail | DALL-E 3 | $0.04 |
| Carousel images (8-10) | Gemini | Free (experimental) |
| Music bed | Lyria | Free (experimental) |
| Platform publish | Blotato | Included |

### Weekly Cost (7 topics, 1 persona)
| Category | Calculation | Cost |
|----------|------------|------|
| Topic generation | 1 batch | $0.15 |
| Content generation | 7 x $0.10 | $0.70 |
| Podcast scripts | 7 x $0.08 | $0.56 |
| Newsletter drafts | 7 x $0.05 | $0.35 |
| Long-form TTS | 7 x $0.45 | $3.15 |
| Podcast TTS | 7 x $4.00 | $28.00 |
| HeyGen videos | 7 x $0.25 | $1.75 |
| Blotato shorts | 28 x $0.10 | $2.80 |
| Thumbnails | 42 x $0.04 | $1.68 |
| **Weekly Total** | | **~$39.14** |
| **Monthly Total** | | **~$157** |

*Note: Podcast TTS is the largest cost driver. Costs scale linearly per persona/brand.*

---

## Known Issues & Technical Debt

### HIGH Priority (Fix Required)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | Analytics pull always inserts zeros — Blotato API returns no engagement fields | `api/analytics/pull/route.ts` | `performance_metrics` table has only useless data |
| H2 | Dual carousel publish path — manual `/api/media/carousel` AND `daily-publish` cron both post to Instagram | `api/media/carousel/route.ts` + `api/cron/daily-publish` | Risk of double-posting carousels |
| H3 | Unguarded `JSON.parse` of Claude response in podcast route | `api/media/podcast/route.ts:111` | Unhandled 500 on malformed AI response |
| H4 | Unguarded `JSON.parse` of Claude response in carousel route | `api/media/carousel/route.ts:88` | Same 500 crash risk |
| H5 | Lyria music generation unreliable, no fallback | `lib/gemini.ts:148-208` | Music beds frequently missing from published content |
| H6 | Missing `NEXT_PUBLIC_SITE_URL` in `.env.example` | `.env.example` | Deployment footgun for RSS + podcast internal calls |
| H7 | Missing `N8N_WEBHOOK_SECRET` in `.env.example` | `.env.example` | Edge Functions will fail HMAC validation silently |

### MEDIUM Priority (Should Fix)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | RSS `<enclosure length="0">` hardcoded | `api/podcast/rss/[brandId]/route.ts:79` | Apple Podcasts/Spotify may reject episodes |
| M2 | `topics` TypeScript type missing `topic_hash` field | `types/database.ts` | Type drift from actual DB schema |
| M3 | Blotato `buildTarget` unsafe cast for threads/bluesky | `lib/blotato.ts:218-221` | API calls may fail for unsupported platform targets |
| M4 | Cost service naming inconsistent: `'anthropic'` vs `'claude'` | `api/media/podcast/route.ts` vs `api/content/generate/route.ts` | Cost rollup splits same vendor across two keys |
| M5 | Podcast duration uses naive 150 wpm estimate | `api/media/podcast/route.ts:134-135` | RSS `<itunes:duration>` will be inaccurate |
| M6 | ElevenLabs cost uses raw char count, not billing unit | `lib/utils.ts:24` | Cost estimates slightly inflated |
| M7 | `lamejs` 1.2.1 unmaintained (8+ years), loaded via `new Function()` | `lib/mp3-encoder.ts` | Fragile workaround for ESM compatibility |
| M8 | `vercel.json` has no SPA rewrite rules | `vercel.json` | May cause deep-link 404s (Next.js usually handles this) |

### LOW Priority (Tech Debt)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| L1 | `estimateClaudeCost` uses Sonnet 3.5 pricing ($3/$15) | `lib/utils.ts:9` | Cost estimates may be stale |
| L2 | `topic_hash` uses MD5 (redundant with pg_trgm) | `api/topics/generate/route.ts:59-62` | No real risk, just unnecessary |
| L3 | README.md is default Next.js boilerplate | `README.md` | No project documentation for new devs |
| L4 | `OPENAI_API_KEY` not documented as required for thumbnails | `.env.example` | Easy to miss during setup |
| L5 | No integration/E2E tests for pipeline | — | Unit tests only cover schemas, prompts, utils |
| L6 | Edge Functions have no unit tests | `supabase/functions/` | 4 untested callback handlers |
| L7 | HeyGen video hardcoded black background | `lib/heygen.ts:82-84` | No per-persona background customization |
| L8 | `N8N_ERROR_WEBHOOK_URL` silently no-ops when unset | `lib/notifications.ts:12` | Operational errors go undetected in production |
| L9 | Unguarded `JSON.parse` in topic generate route | `api/topics/generate/route.ts:47` | Same class of bug as H3/H4 |
| L10 | `daily-media` cron confusing brace/indentation alignment | `api/cron/daily-media/route.ts:69-482` | Maintenance hazard |

---

## Differences from PRD v1.0

### Added (Not in Original PRD)
- Podcast generation pipeline (Claude script → ElevenLabs TTS → RSS feed)
- Newsletter draft generation (Claude → Substack format)
- HeyGen avatar video (replaces Blotato for long-form)
- Canva carousel design autofill
- DALL-E 3 thumbnail generation (with Gemini fallback)
- Gemini Lyria music generation
- `brands` table (multi-brand hierarchy above personas)
- n8n Edge Function callbacks (4 async webhook handlers)
- Workflow locks (concurrent cron prevention)
- Evergreen content system (auto-reschedule low-performing topics)
- Content remix endpoint (regenerate single field)
- Health check endpoint (7-service ping)
- `content_ideas` backlog table
- `performance_metrics` analytics table
- Bluesky platform support
- `daily-media` cron (separate from publish)
- Content hash deduplication

### Removed/Changed from Original PRD
- Popup Story modal (`/popup`) — not implemented
- Calendar page (`/calendar`) with drag-to-reschedule — not implemented
- Email notifications — replaced with n8n webhook
- Blotato as sole video provider — split: HeyGen (long) + Blotato (shorts)
- ElevenLabs via Blotato — now direct ElevenLabs API
- 5 platforms → 8 platforms (added Bluesky, expanded)
- `check-status` runs every 10 min (not 5 min as PRD specified)
- `daily-publish` runs hourly (not once at 6 AM)

### Not Yet Implemented (from PRD v1.0)
- Popup Story quick-post modal
- Calendar view with drag-to-reschedule
- Voice audio preview in review UI
- Email notification system
- A/B testing hooks
- Multi-language support
- Collaboration features
- Template library
- Scheduling optimization AI

---

## Success Criteria (Updated)

- [x] Select persona and generate 7 topics in < 2 minutes
- [x] Generate all content for 7 topics in < 10 minutes
- [x] Review and schedule entire week in < 2 hours total
- [x] Daily media generation runs automatically at 6 AM
- [x] Daily publishing runs hourly for scheduled content
- [x] No duplicate topics within 90-day window (pg_trgm)
- [x] Voice rotation uses all 18 voices evenly (LRU)
- [x] Cost tracking per API call
- [x] Multi-brand architecture ready
- [ ] Popup story goes from idea to published in < 15 minutes (not implemented)
- [ ] 95%+ publish success rate (blocked by Lyria reliability + analytics gap)
- [ ] Weekly cost stays under $20 (actual ~$39/week with podcast TTS)
- [ ] All content publishes to all target platforms (carousel only → Instagram)

---

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run test         # Run vitest
npm run test:watch   # Watch mode
npm run lint         # ESLint
```
