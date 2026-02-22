# External Integrations

**Analysis Date:** 2026-02-22

## APIs & External Services

**AI Content Generation:**
- Anthropic Claude - LLM for text content generation (scripts, captions, topic research)
  - SDK/Client: `@anthropic-ai/sdk`; singleton at `src/lib/claude.ts`
  - Default model: `claude-sonnet-4-5-20250929`; max tokens: 4096
  - Auth: `ANTHROPIC_API_KEY`

- Google Gemini - Alternative LLM for content; also used for image generation (fallback to DALL-E) and background music via Google Lyria RealTime
  - SDK/Client: `@google/genai` + raw HTTP; singleton at `src/lib/gemini.ts`
  - Text model: `gemini-2.0-flash`; image model: `gemini-2.0-flash-exp`; music model: `models/lyria-realtime-exp`
  - Lyria outputs 48 kHz stereo PCM; encoded to MP3 via `@breezystack/lamejs`
  - Auth: `GEMINI_API_KEY`

- OpenAI DALL-E 3 - Primary thumbnail and carousel slide image generation
  - SDK/Client: raw fetch; singleton at `src/lib/openai.ts`
  - Model: `dall-e-3`; sizes: `1024x1024` (default), `1024x1792`, `1792x1024`
  - Auth: `OPENAI_API_KEY`

**Video & Media Production:**
- HeyGen - AI avatar video generation from audio or text scripts
  - SDK/Client: raw fetch; singleton at `src/lib/heygen.ts`
  - Base URL: `https://api.heygen.com`; API version: v2 (video generate), v1 (status)
  - Output: 1080x1920 portrait video for short-form platforms
  - Auth header: `X-Api-Key: HEYGEN_API_KEY`
  - Auth: `HEYGEN_API_KEY`

- Blotato - Faceless short-form video creation from templates + social media publishing across 9 platforms
  - SDK/Client: raw fetch; singleton at `src/lib/blotato.ts`
  - Base URL: `https://backend.blotato.com/v2`
  - Supported platforms: `twitter`, `linkedin`, `facebook`, `instagram`, `pinterest`, `tiktok`, `threads`, `bluesky`, `youtube`
  - Features: video creation from templates, media upload, publish now, scheduled publish, multi-account
  - Auth header: `blotato-api-key: BLOTATO_API_KEY`

- ElevenLabs - Text-to-speech for voice narration (feeds HeyGen avatar videos)
  - SDK/Client: raw fetch; singleton at `src/lib/elevenlabs.ts`
  - Base URL: `https://api.elevenlabs.io`
  - Default model: `eleven_multilingual_v2`
  - Auth header: `xi-api-key: ELEVENLABS_API_KEY`

**Design & Carousel:**
- Canva Connect API - Carousel design generation using brand templates; autofill with generated text and images
  - SDK/Client: raw fetch; singleton at `src/lib/canva.ts`
  - Base URL: `https://api.canva.com/rest`
  - Features: asset upload, brand template autofill (async), design export (PNG/JPG/PDF)
  - Auth: Bearer token `CANVA_API_KEY`

**Workflow Automation:**
- n8n (self-hosted) - Orchestrates the content pipeline; triggers via webhooks from Next.js API routes; callbacks received via Supabase Edge Functions
  - Incoming callbacks: 4 Supabase Edge Functions (see Webhooks section)
  - Error notifications: outgoing POST to `N8N_ERROR_WEBHOOK_URL`
  - Security: HMAC-SHA256 (`X-N8N-Signature` header); secret: `N8N_WEBHOOK_SECRET`

**Email Notifications:**
- Resend - Transactional email for error alerts, publish success, and daily digest
  - SDK/Client: raw fetch; implementation at `src/lib/email.ts`
  - Base URL: `https://api.resend.com/emails`
  - Optional: app is fully functional without this (graceful fallback with console warning)
  - Auth: Bearer token `RESEND_API_KEY`
  - From: configured via `RESEND_FROM_EMAIL`; recipient via `NOTIFICATION_EMAIL`

## Data Storage

**Databases:**
- Supabase PostgreSQL 16
  - Project ref: `qjpujskwqaehxnqypxzu`
  - Connection: `NEXT_PUBLIC_SUPABASE_URL`
  - Client: `@supabase/supabase-js` + `@supabase/ssr`
  - Schema managed via migrations in `supabase/migrations/`
  - Extensions: `pg_trgm` (text similarity for duplicate topic detection)
  - Tables: `brands`, `personas`, `topics`, `content_pieces`, `podcast_episodes`, `audio_assets`, `visual_assets`, `voices`, `published_log`, `cost_tracking`, `performance_metrics`, `content_ideas`, `workflow_locks`
  - Row Level Security enabled on all tables; policy: authenticated users have full access (single-operator system)
  - Custom functions: `get_lru_voice()`, `check_duplicate_topic()`
  - View: `cost_summary`

**File Storage:**
- Supabase Storage - Media files (audio MP3, images PNG/JPEG)
  - Implementation: `src/lib/storage.ts`
  - Bucket: `media` (public, 50 MB file size limit)
  - Allowed types: `audio/mpeg`, `audio/wav`, `audio/mp4`, `video/mp4`, `image/png`, `image/jpeg`
  - Helpers: `uploadAudio()`, `uploadImage()` — auto-creates bucket if missing

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- Supabase Auth
  - Implementation: `src/lib/supabase/client.ts` (browser client) and `src/lib/supabase/server.ts` (server/admin clients)
  - Browser client: `createBrowserClient` from `@supabase/ssr`
  - Server client: `createServerClient` from `@supabase/ssr` (cookie-based session)
  - Admin client: `createAdminClient()` uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS for cron/server operations)
  - Auth callback route: `src/app/api/auth/callback/` (OAuth exchange)

## Monitoring & Observability

**Error Tracking:**
- Dual-channel error notifications via `src/lib/notifications.ts`:
  1. n8n webhook (fire-and-forget POST to `N8N_ERROR_WEBHOOK_URL`)
  2. Resend email alert to `NOTIFICATION_EMAIL`
- Cost tracking: all API calls logged to `cost_tracking` table with service, operation, topic_id, cost_usd, token counts

**Logs:**
- `console.log` / `console.error` / `console.warn` — standard Next.js server logging (Vercel captures these)

## CI/CD & Deployment

**Hosting:**
- Vercel (Next.js deployment; serverless functions)
- Supabase (managed PostgreSQL + Storage + Edge Functions)

**CI Pipeline:**
- None detected

**Cron Jobs (Vercel):**
- `GET /api/cron/daily-media` — runs at 06:00 UTC daily; generates audio (ElevenLabs), video (HeyGen/Blotato), thumbnails (DALL-E/Gemini), carousels (Canva), music (Lyria), podcasts
- `GET /api/cron/daily-publish` — runs every hour; publishes ready content via Blotato
- `GET /api/cron/check-status` — runs every 10 minutes; polls HeyGen/Blotato job statuses, cleans stale workflow locks
- All cron routes protected by `CRON_SECRET` header validation (`src/app/api/cron/middleware.ts`)
- Max serverless function duration: 300 seconds (`export const maxDuration = 300`)

## Webhooks & Callbacks

**Incoming (from n8n):**
Supabase Edge Functions receive HMAC-signed POST callbacks from n8n:
- `supabase/functions/n8n-topic-callback/index.ts` — updates `topics` table status (`content_ready`, `published`, `failed`)
- `supabase/functions/n8n-research-callback/index.ts` — updates research/content data
- `supabase/functions/n8n-asset-callback/index.ts` — updates asset URLs on content pieces
- `supabase/functions/n8n-publish-callback/index.ts` — updates publish log
- All use HMAC-SHA256 validation via `supabase/functions/_shared/hmac.ts`; secret: `N8N_WEBHOOK_SECRET`
- All use Supabase service role client via `supabase/functions/_shared/supabase.ts`

**Outgoing (to n8n):**
- Error notifications: POST to `N8N_ERROR_WEBHOOK_URL` (optional; fire-and-forget)

**Podcast RSS:**
- Public RSS feed endpoint: `GET /api/podcast/rss/[brandId]` — serves podcast XML for external podcast platforms

## Environment Configuration

**Required env vars:**
```
NEXT_PUBLIC_SUPABASE_URL       # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY  # Supabase anon key (public)
SUPABASE_SERVICE_ROLE_KEY      # Supabase service role key (admin, server-only)
SUPABASE_PROJECT_REF           # Project ref for CLI operations
SUPABASE_ACCESS_TOKEN          # Supabase personal access token (CLI)
ANTHROPIC_API_KEY              # Claude API access
OPENAI_API_KEY                 # DALL-E 3 image generation
GEMINI_API_KEY                 # Gemini text + Lyria music generation
BLOTATO_API_KEY                # Video creation + social publishing
HEYGEN_API_KEY                 # Avatar video generation
ELEVENLABS_API_KEY             # Text-to-speech
CANVA_API_KEY                  # Carousel design generation
CRON_SECRET                    # Vercel cron route security
NEXT_PUBLIC_SITE_URL           # Used for RSS feed URLs and internal podcast API calls
N8N_WEBHOOK_SECRET             # HMAC validation for Edge Function callbacks
```

**Optional env vars (graceful degradation if unset):**
```
N8N_ERROR_WEBHOOK_URL          # n8n error notification webhook
RESEND_API_KEY                 # Email notifications (disabled if unset)
RESEND_FROM_EMAIL              # From address (defaults to noreply@faithharmony.com)
NOTIFICATION_EMAIL             # Recipient for error/publish emails
```

**Secrets location:**
- Local: `.env.local` (gitignored)
- Production: Vercel environment variables dashboard
- Supabase Edge Functions: Supabase project secrets (set via `supabase secrets set`)

---

*Integration audit: 2026-02-22*
