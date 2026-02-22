# Codebase Structure

**Analysis Date:** 2026-02-22

## Directory Layout

```
fhcontent-creator-v2/
├── src/
│   ├── app/                        # Next.js App Router root
│   │   ├── layout.tsx              # Root layout — nav, auth check, Toaster
│   │   ├── page.tsx                # Dashboard (client component)
│   │   ├── loading.tsx             # Global loading UI
│   │   ├── error.tsx               # Global error boundary
│   │   ├── globals.css             # Tailwind base styles
│   │   ├── login/
│   │   │   └── page.tsx            # Login page
│   │   ├── plan/
│   │   │   └── page.tsx            # Content planning — topic list, generate actions
│   │   ├── review/
│   │   │   └── [topicId]/
│   │   │       └── page.tsx        # Topic review — scripts, media, approve/schedule/publish
│   │   ├── personas/
│   │   │   ├── page.tsx            # Persona list
│   │   │   ├── new/page.tsx        # Create persona form
│   │   │   └── [id]/edit/page.tsx  # Edit persona form
│   │   ├── calendar/
│   │   │   └── page.tsx            # Publishing calendar view
│   │   ├── costs/
│   │   │   ├── page.tsx            # Cost tracking dashboard
│   │   │   ├── helpers.ts          # Cost calculation utilities
│   │   │   └── helpers.spec.ts     # Unit tests
│   │   └── api/
│   │       ├── health/route.ts     # GET /api/health — connectivity check for all services
│   │       ├── auth/
│   │       │   └── callback/route.ts  # Supabase OAuth callback handler
│   │       ├── topics/
│   │       │   ├── generate/route.ts  # POST — Claude topic generation + dedup check
│   │       │   ├── calendar/route.ts  # GET — topics by date range for calendar view
│   │       │   └── [id]/
│   │       │       ├── approve/route.ts   # POST — transition topic to 'approved'
│   │       │       ├── schedule/route.ts  # POST — set publish_date, transition to 'scheduled'
│   │       │       └── publish/route.ts   # POST — immediate publish (calls publishTopic)
│   │       ├── content/
│   │       │   ├── generate/route.ts      # POST — Claude content generation (6 pieces)
│   │       │   ├── newsletter-draft/route.ts  # POST — Claude newsletter draft
│   │       │   ├── quick-post/route.ts    # POST — one-off post bypassing pipeline
│   │       │   └── [id]/
│   │       │       ├── route.ts           # PATCH — update content piece fields
│   │       │       ├── regenerate/route.ts  # POST — regenerate all fields for one piece
│   │       │       └── remix/route.ts     # POST — regenerate single field (script, captions, etc.)
│   │       ├── media/
│   │       │   ├── voice/route.ts         # POST — ElevenLabs TTS for a piece
│   │       │   ├── voice-preview/route.ts # POST — ElevenLabs preview (≤500 chars, no save)
│   │       │   ├── video/route.ts         # POST — HeyGen avatar video submission
│   │       │   ├── thumbnail/route.ts     # POST — DALL-E thumbnail (Gemini fallback)
│   │       │   ├── carousel/route.ts      # POST — Canva autofill carousel design
│   │       │   ├── music/route.ts         # POST — Gemini Lyria background music
│   │       │   └── podcast/route.ts       # POST — Claude podcast script + ElevenLabs audio
│   │       ├── podcast/
│   │       │   └── rss/[brandId]/route.ts # GET — RSS feed XML for podcast app ingestion
│   │       ├── analytics/
│   │       │   └── pull/route.ts          # POST — Pull engagement metrics from platforms
│   │       └── cron/
│   │           ├── middleware.ts          # CRON_SECRET header validation
│   │           ├── middleware.spec.ts     # Unit tests
│   │           ├── daily-media/route.ts   # GET — 6AM; video/thumbnail/carousel/music/podcast
│   │           ├── daily-publish/
│   │           │   ├── route.ts           # GET — hourly; find + publish scheduled topics
│   │           │   ├── helpers.ts         # Platform routing, media URL resolution
│   │           │   ├── helpers.spec.ts    # Unit tests
│   │           │   └── publish.spec.ts    # Integration-style tests for publishTopic
│   │           └── check-status/route.ts  # GET — every 10min; poll async jobs, promote statuses
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives (auto-generated, do not edit manually)
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── select.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── tabs.tsx
│   │   │   └── textarea.tsx
│   │   ├── analytics-summary.tsx   # Analytics metrics display widget
│   │   ├── nav-links.tsx           # Top navigation links
│   │   ├── persona-card.tsx        # Persona display card
│   │   ├── persona-switcher.tsx    # Multi-persona filter UI
│   │   ├── quick-post-dialog.tsx   # One-off post dialog (bypasses pipeline)
│   │   └── sign-out-button.tsx     # Supabase sign-out button
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Browser Supabase client (anon key, typed)
│   │   │   └── server.ts           # Server Supabase clients: createClient() + createAdminClient()
│   │   ├── claude.ts               # Anthropic SDK singleton
│   │   ├── blotato.ts              # Blotato social publishing + faceless video client
│   │   ├── heygen.ts               # HeyGen avatar video client
│   │   ├── elevenlabs.ts           # ElevenLabs TTS client
│   │   ├── openai.ts               # OpenAI DALL-E image client
│   │   ├── gemini.ts               # Google Gemini image + Lyria music client
│   │   ├── canva.ts                # Canva Autofill API client
│   │   ├── email.ts                # Resend error email client
│   │   ├── storage.ts              # Supabase Storage helpers (uploadAudio, uploadImage)
│   │   ├── notifications.ts        # Fire-and-forget error notifications (n8n + email)
│   │   ├── workflow-lock.ts        # Distributed lock: acquireLock/releaseLock/cleanStaleLocks
│   │   ├── evergreen.ts            # Evergreen fallback scheduling logic
│   │   ├── prompts.ts              # All Claude prompt builders
│   │   ├── schemas.ts              # Zod schemas for API I/O and Claude response validation
│   │   ├── utils.ts                # Shared utilities (cost estimates, word count, etc.)
│   │   ├── blotato.spec.ts         # Unit tests
│   │   ├── gemini.spec.ts          # Unit tests
│   │   ├── notifications.spec.ts   # Unit tests
│   │   ├── prompts.spec.ts         # Unit tests
│   │   ├── schemas.spec.ts         # Unit tests
│   │   ├── schemas-approval.spec.ts # Unit tests
│   │   └── utils.spec.ts           # Unit tests
│   ├── types/
│   │   └── database.ts             # Full Supabase DB type, enums, convenience aliases
│   ├── scripts/                    # One-off admin scripts (run with tsx, not Next.js)
│   │   ├── create-user.ts          # Manually provision a Supabase auth user
│   │   ├── run-migration.ts        # Run a SQL migration manually
│   │   ├── seed-personas.ts        # Seed default persona data
│   │   └── seed-voices.ts          # Seed ElevenLabs voice roster
│   └── middleware.ts               # Next.js middleware — auth gate for all routes
├── supabase/
│   ├── migrations/                 # Applied migrations — never edit existing files
│   │   ├── 001_v2_schema.sql       # Base schema: personas, topics, content_pieces, etc.
│   │   ├── 002_add_content_hash.sql
│   │   ├── 003_brands_and_schema_updates.sql
│   │   ├── 004_workflow_locks.sql
│   │   ├── 005_analytics_and_ideas.sql
│   │   ├── 006_brands_podcast_outro_cta.sql
│   │   └── 007_add_blotato_template_id.sql
│   └── functions/                  # Supabase Edge Functions (Deno runtime)
│       ├── _shared/
│       │   ├── cors.ts             # CORS headers for all edge functions
│       │   ├── hmac.ts             # HMAC-SHA256 validation (X-N8N-Signature)
│       │   └── supabase.ts         # Deno Supabase service client factory
│       ├── n8n-topic-callback/index.ts    # Update topics.status from n8n
│       ├── n8n-research-callback/index.ts # Handle n8n research phase callback
│       ├── n8n-asset-callback/index.ts    # Write asset URLs to content_pieces + visual_assets
│       └── n8n-publish-callback/index.ts  # Update publish status from n8n
├── public/                         # Static assets
├── .planning/                      # GSD planning artifacts (not deployed)
│   └── codebase/                   # Codebase analysis docs
├── .claude/                        # Claude Code project config
├── next.config.ts                  # Next.js config (minimal, no custom rewrites)
├── tsconfig.json                   # TypeScript config
├── vercel.json                     # Vercel cron schedule definitions
├── vitest.config.ts                # Vitest test runner config
├── components.json                 # shadcn/ui component registry config
├── package.json                    # Node.js dependencies
├── CLAUDE.md                       # Project-level Claude Code instructions
├── PRD-v2.0.md                     # Product requirements document
├── progress.md                     # GSD phase progress tracking
└── task_plan.md                    # GSD task plan
```

## Directory Purposes

**`src/app/api/`:**
- Purpose: All API endpoints. Organized by domain, not by HTTP method.
- Contains: `route.ts` files exporting named HTTP handlers (`GET`, `POST`, `PATCH`, etc.)
- Key files: `health/route.ts` (service connectivity check), `cron/` (automated pipeline)

**`src/app/api/cron/`:**
- Purpose: Vercel-scheduled workers. These are the automation backbone of the app.
- Contains: Three GET route handlers + shared `middleware.ts` for auth validation
- Note: `maxDuration = 300` is set on all three — they use Vercel's 5-minute function timeout

**`src/components/ui/`:**
- Purpose: shadcn/ui primitives. Auto-generated via shadcn CLI.
- Contains: Unstyled-then-themed React components (Button, Card, Badge, Tabs, etc.)
- Rule: Do not hand-edit these files. Add components via `npx shadcn@latest add <component>`.

**`src/components/` (root level):**
- Purpose: App-specific composite components shared across pages.
- Contains: `persona-switcher.tsx`, `analytics-summary.tsx`, `quick-post-dialog.tsx`, `nav-links.tsx`, `sign-out-button.tsx`, `persona-card.tsx`

**`src/lib/`:**
- Purpose: All business logic, external API clients, and shared utilities. Nothing here renders UI.
- Rule: API routes and cron jobs import from here. UI pages should not import service clients directly.

**`src/lib/supabase/`:**
- Purpose: Two Supabase client factories.
- Rule: Use `createClient()` from `client.ts` in `'use client'` components. Use `createAdminClient()` from `server.ts` in all API routes and cron jobs (service role bypasses RLS).

**`src/types/`:**
- Purpose: Single source of truth for all TypeScript types derived from the database schema.
- Rule: Keep this file in sync with `supabase/migrations/`. Add new Row/Insert/Update types here when adding tables.

**`src/scripts/`:**
- Purpose: One-off admin utilities. Not part of the Next.js app build.
- Run with: `npx tsx src/scripts/<file>.ts`

**`supabase/migrations/`:**
- Purpose: Ordered SQL migration history.
- Rule: NEVER edit existing migration files. Always create a new file with the next sequential number (e.g., `008_...sql`).
- Naming: `NNN_descriptive_name.sql` where NNN is a three-digit sequence number.

**`supabase/functions/`:**
- Purpose: Deno-based serverless functions deployed to Supabase Edge Network.
- Runtime: Deno, not Node.js. Import from `npm:` or `https://deno.land/x/`.
- Deploy: `supabase functions deploy <function-name>`

## Key File Locations

**Entry Points:**
- `src/middleware.ts` — Auth gate, runs before every request
- `src/app/layout.tsx` — Root layout, session check, nav
- `src/app/page.tsx` — Dashboard (default route `/`)

**Configuration:**
- `vercel.json` — Cron schedule definitions (3 crons)
- `tsconfig.json` — TypeScript compiler options; `@/` path alias → `./src`
- `components.json` — shadcn/ui registry (style: default, baseColor: neutral, cssVariables: true)
- `vitest.config.ts` — Test runner config

**Core Business Logic:**
- `src/lib/prompts.ts` — All Claude prompts
- `src/lib/schemas.ts` — All Zod schemas (request validation + Claude response validation)
- `src/lib/workflow-lock.ts` — Distributed lock for cron concurrency
- `src/lib/evergreen.ts` — Evergreen content fallback
- `src/lib/storage.ts` — Supabase Storage media uploads

**Database:**
- `src/types/database.ts` — Full type definitions
- `supabase/migrations/` — Migration history (7 applied migrations)

**Testing:**
- Co-located `.spec.ts` files next to the source file they test
- `src/lib/*.spec.ts` — Unit tests for service clients, schemas, utils
- `src/app/api/cron/daily-publish/helpers.spec.ts` — Cron helper unit tests
- `src/app/api/cron/daily-publish/publish.spec.ts` — Publish integration tests
- `src/app/api/cron/middleware.spec.ts` — Cron auth middleware tests
- `src/app/costs/helpers.spec.ts` — Cost helper tests

## Naming Conventions

**Files:**
- Route handlers: `route.ts` (enforced by Next.js App Router)
- Page components: `page.tsx` (enforced by Next.js App Router)
- Spec files: `<name>.spec.ts` co-located with the source file
- Helper modules: `helpers.ts` when a route needs shared non-route logic
- Service clients: `<service-name>.ts` (e.g., `blotato.ts`, `heygen.ts`)

**Directories:**
- Feature directories: kebab-case (e.g., `daily-publish/`, `check-status/`, `quick-post/`)
- Dynamic segments: `[id]`, `[topicId]`, `[brandId]` using Next.js bracket notation
- Shared utilities: `_shared/` (edge functions), prefix with underscore to sort first and signal internal use

**TypeScript:**
- Types/interfaces: PascalCase (e.g., `TopicWithPersona`, `PublishResult`)
- Type union values: string literals in camelCase or snake_case matching DB column values (e.g., `'content_ready'`, `'topics_approved'`)
- Exported singleton instances: camelCase matching service name (e.g., `export const blotato = new BlotatoClient()`)

**API Routes:**
- Resource-based paths: `/api/topics/[id]/approve`, `/api/content/[id]/remix`
- Cron paths: `/api/cron/<job-name>`
- Media generation: `/api/media/<media-type>`

## Where to Add New Code

**New UI Page:**
- Create directory at `src/app/<route-name>/page.tsx`
- Mark as `'use client'` if it needs state or browser APIs
- Use `createClient()` from `src/lib/supabase/client.ts` for data fetching
- Use `fetch()` to hit API routes for mutations

**New API Endpoint:**
- Create `src/app/api/<domain>/route.ts` or `src/app/api/<domain>/[id]/<action>/route.ts`
- Import `createAdminClient` from `src/lib/supabase/server.ts`
- Validate body with a Zod schema from `src/lib/schemas.ts`
- Return `NextResponse.json({ success: true, ... })` or `{ success: false, error: string }`
- Add the Zod schema to `src/lib/schemas.ts` first

**New External Service Client:**
- Create `src/lib/<service>.ts` following the singleton class pattern (see `src/lib/blotato.ts`)
- Export a singleton: `export const myService = new MyServiceClient()`
- Add a `testConnection()` method for use in `/api/health`
- Add env var name to the health check route

**New Database Table:**
- Create `supabase/migrations/NNN_<description>.sql` (next sequential number)
- Add `Row`, `Insert`, `Update` types to `src/types/database.ts` under `Database['public']['Tables']`
- Add convenience alias at the bottom of `src/types/database.ts`

**New Supabase Edge Function:**
- Create `supabase/functions/<function-name>/index.ts` using the Deno `Deno.serve()` pattern
- Import from `supabase/functions/_shared/` for CORS, HMAC, and Supabase client
- Deploy: `supabase functions deploy <function-name>`

**New Claude Prompt:**
- Add a `buildXxxPrompt()` function to `src/lib/prompts.ts`
- Return `{ system: string; user: string }` (add `maxTokens?: number` if needed)
- Add a corresponding Zod response schema to `src/lib/schemas.ts`

**New Shadcn Component:**
- Run `npx shadcn@latest add <component>` — it writes to `src/components/ui/`
- Do not create files in `src/components/ui/` manually

**New Cron Job:**
- Create `src/app/api/cron/<job-name>/route.ts`
- Start with `validateCronSecret(request)` check (import from `../middleware`)
- Use `acquireLock`/`releaseLock` from `src/lib/workflow-lock.ts` for idempotency
- Set `export const maxDuration = 300` for long-running jobs
- Add entry to `vercel.json` under `"crons"` with a cron schedule expression

## Special Directories

**`.planning/`:**
- Purpose: GSD workflow artifacts (phase plans, codebase analysis, progress tracking)
- Generated: Partially (by GSD commands), partially manually edited
- Committed: Yes — tracks project planning history

**`.claude/`:**
- Purpose: Claude Code project-level skills and commands (symlinked from global skill pool)
- Generated: By `skill-router.sh` auto-configuration
- Committed: No (symlinks are local)

**`supabase/functions/_shared/`:**
- Purpose: Shared Deno utilities imported by all edge functions
- Generated: No — manually maintained
- Committed: Yes

**`node_modules/`:**
- Generated: Yes (npm install)
- Committed: No

---

*Structure analysis: 2026-02-22*
