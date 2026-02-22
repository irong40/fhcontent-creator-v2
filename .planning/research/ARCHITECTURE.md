# Architecture Research: n8n + Next.js + Supabase

> Researched: 2026-02-22
> Codebase analyzed: fhcontent-creator-v2 (full read of cron routes, Edge Functions, API routes, HMAC shared library)
> Sources: n8n Docs, n8n Community, ngrok Docs, n8n Blog, Medium/nocodecreative

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DASHBOARD (Vercel / Next.js App Router)                                    │
│  src/app/(dashboard)/...                                                     │
│                                                                             │
│  On-demand button click  ─────────────────────────────────────────────────┐ │
│  POST /api/topics/generate                                                  │ │
│  POST /api/topics/[id]/schedule                                             │ │
└─────────────────────────────────────────────────────────────────────────────┘ │
          │                                                                    │
          │ n8n webhook URL (HTTPS via Cloudflare Tunnel)                      │
          ▼                                                                    │
┌─────────────────────────────────────────────────────────────────────────────┐ │
│  n8n (self-hosted, Windows local machine)                                   │ │
│                                                                             │ │
│  WF-1: Topic Pipeline      WF-2: Media Pipeline    WF-5: Status Poller     │ │
│  ┌────────────────┐        ┌────────────────┐       ┌────────────────┐      │ │
│  │ Webhook Trigger│        │ Cron 6AM daily │       │ Cron */10 min  │      │ │
│  │ (on-demand)    │        │ + Webhook Trig │       │                │      │ │
│  └───────┬────────┘        └───────┬────────┘       └───────┬────────┘      │ │
│          │                         │                         │               │ │
│          ▼                         ▼                         ▼               │ │
│  POST Next.js API routes   POST Next.js API routes   GET Next.js API        │ │
│  /api/topics/generate      /api/media/video           /api/cron/check-status│ │
│  /api/topics/[id]/schedule /api/media/thumbnail       (or direct Supabase   │ │
│  /api/content/[id]/regen   /api/media/carousel         queries)             │ │
│          │                 /api/media/podcast                │               │ │
│          │                 /api/media/music                  │               │ │
│          │                         │                         │               │ │
│          ▼                         ▼                         ▼               │ │
│  WF-3: Research            Wait Node (5-10 min)      HMAC POST to Supabase  │ │
│  ┌────────────────┐        resume via webhook         Edge Functions         │ │
│  │ Execute Sub-WF │        or scheduled poll          n8n-asset-callback     │ │
│  │ (from WF-1)    │                │                  n8n-topic-callback     │ │
│  └───────┬────────┘                │                         │               │ │
│          │                WF-4: Publish Pipeline             │               │ │
│          ▼                ┌────────────────┐                 │               │ │
│  Perplexity / web search  │ Cron hourly    │                 │               │ │
│  → HMAC POST              │ + Webhook Trig │                 │               │ │
│    n8n-research-callback  └───────┬────────┘                 │               │ │
│                                   │                          │               │ │
│                           POST /api/cron/daily-publish       │               │ │
│                           → HMAC POST n8n-publish-callback   │               │ │
└─────────────────────────────────────────────────────────────────────────────┘ │
          │                         │                         │                 │
          └──────────────┬──────────┘─────────────────────────┘                 │
                         ▼                                                       │
┌──────────────────────────────────────────────┐                                │
│  Supabase Edge Functions (Deno / public HTTPS)│◄───────────────────────────────┘
│                                              │
│  n8n-topic-callback    → topics table        │
│  n8n-research-callback → topics.historical_points│
│  n8n-asset-callback    → content_pieces +   │
│                          visual_assets       │
│  n8n-publish-callback  → content_pieces +   │
│                          published_log       │
│                                              │
│  All validated via HMAC-SHA256               │
│  Header: X-N8N-Signature                     │
└──────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────┐
│  PostgreSQL (Supabase)                       │
│  topics, content_pieces, audio_assets,       │
│  visual_assets, podcast_episodes,            │
│  published_log, cost_tracking,               │
│  workflow_locks, performance_metrics         │
└──────────────────────────────────────────────┘
```

---

## Data Flow

This describes the full pipeline for a single topic from creation through publication.

### Step 1 — Topic Seeding (WF-1: Topic Pipeline)

```
Dashboard click "Generate Topics"
  → POST /api/topics/generate { personaId, count }
  → Next.js calls Claude API (claude.ts)
  → Inserts rows into topics (status: 'draft')
  → Returns topic IDs
```

Alternatively, the dashboard triggers WF-1's webhook directly, and n8n calls
`POST /api/topics/generate`. Either topology works; the recommended pattern is
to have the dashboard trigger n8n (so the full pipeline runs in one place) rather
than calling the Next.js route and then having n8n pick up from DB state.

### Step 2 — Research Enrichment (WF-3: Research, called as sub-workflow from WF-1)

```
WF-1 calls Execute Sub-Workflow → WF-3
  → WF-3: Perplexity/Tavily HTTP Request (web research)
  → WF-3: Builds sources array
  → WF-3: HMAC-signs payload
  → WF-3: POST to n8n-research-callback Edge Function
       { topic_id, sources: [{ url, title, summary }] }
  → Edge Function merges into topics.historical_points._research_sources
  → WF-3 returns { topic_id, sources_count } to WF-1
```

WF-3 runs synchronously inside WF-1 via Execute Sub-Workflow with
"Wait for Sub-Workflow Completion = ON". Total expected duration: < 30 seconds.

### Step 3 — Content Generation (still within WF-1)

```
WF-1 (after research):
  → POST /api/topics/[id]/generate-content (new route, or reuse /api/topics/generate)
       triggers Claude to generate scripts, captions, carousel_slides, thumbnail_prompt
  → Next.js writes content_pieces rows (status: 'draft')
  → WF-1: HMAC POST to n8n-topic-callback
       { topic_id, status: 'content_ready' }
  → Edge Function sets topics.status = 'content_ready'
```

### Step 4 — Media Generation (WF-2: Media Pipeline)

```
Trigger: Cron 6AM daily OR webhook from WF-1 (fire-and-forget)

WF-2 queries Supabase directly:
  SELECT topics WHERE status IN ('content_ready', 'approved', 'scheduled')

For each topic, in parallel branches:
  Branch A (HeyGen long-form):
    → POST /api/media/voice { topicId, pieceId }   → ElevenLabs TTS → audio_url
    → POST /api/media/video { contentPieceId, avatarId, audioUrl }
    → HeyGen returns job_id immediately
    → n8n records job_id, enters ASYNC WAIT (see Async section below)

  Branch B (Blotato short-form × 4):
    → POST /api/media/video { contentPieceId, blotatoTemplateId }
    → Blotato returns job_id immediately
    → n8n enters ASYNC WAIT

  Branch C (Thumbnails — synchronous, fast):
    → POST /api/media/thumbnail { pieceId, prompt }
    → DALL-E/Gemini → Supabase Storage → returns URL
    → HMAC POST n8n-asset-callback { content_piece_id, asset_type: 'thumbnail', asset_url }

  Branch D (Carousel — synchronous, ~45s):
    → POST /api/media/carousel { pieceId, slides, templateId }
    → Canva autofill → export PNG → returns carousel_url
    → HMAC POST n8n-asset-callback { content_piece_id, asset_type: 'carousel', asset_url }

  Branch E (Podcast — synchronous, ~30s):
    → POST /api/media/podcast { topicId, brandId }

  Branch F (Music — synchronous, ~20s):
    → POST /api/media/music { pieceId, mood, duration }
```

### Step 5 — Async Video Resolution (WF-5: Status Poller)

```
Every 10 minutes:
  → n8n queries content_pieces WHERE heygen_status = 'processing'
  → For each: GET /api/media/video/status { jobId }  (or direct HeyGen API)
  → If completed:
      → HMAC POST n8n-asset-callback
           { content_piece_id, asset_type: 'video', asset_url: video_url }
      → Edge Function sets content_pieces.video_url, status: 'produced'
  → If failed:
      → Increment retry_count, reset heygen_status = null (re-queued for WF-2)
  → Same logic for blotato_status = 'processing'
```

### Step 6 — Publishing (WF-4: Publish Pipeline)

```
Trigger: Cron hourly OR webhook from dashboard "Publish Now"

WF-4 queries: topics WHERE status = 'scheduled' AND publish_date <= today

For each topic:
  → POST /api/cron/daily-publish { topicId }  (reuses existing route)
     OR call new /api/topics/[id]/publish route
  → Blotato publishes to 8 platforms, returns post submission IDs
  → WF-4: HMAC POST n8n-publish-callback for each confirmed platform
  → WF-5 (poller) later confirms actual publish status via Blotato poll
```

---

## Workflow Interconnection Patterns

### The 5 Workflows

| # | Name | Trigger | Role |
|---|------|---------|------|
| WF-1 | Topic Pipeline | Webhook (on-demand) + Cron weekly | Orchestrator: generates topics, enriches with research, spawns WF-3 |
| WF-2 | Media Pipeline | Cron 6AM daily + Webhook (manual trigger) | Fan-out: generates all media assets in parallel branches |
| WF-3 | Research Sub-Workflow | Execute Sub-Workflow from WF-1 | Leaf: web research + n8n-research-callback write |
| WF-4 | Publish Pipeline | Cron hourly + Webhook (dashboard trigger) | Sequential: query scheduled → publish → callback |
| WF-5 | Status Poller | Cron every 10 minutes | Sweeper: polls async jobs (HeyGen, Blotato), writes completions |

### Interconnection Decision: Execute Sub-Workflow vs Webhook Chaining

**Use Execute Sub-Workflow (synchronous, parent waits):**
- WF-1 → WF-3 (Research): WF-1 needs the research data before it can call Claude for
  content generation. Synchronous is correct here.
- Any reusable "utility" logic called from multiple parents (e.g., a "write to DB via
  HMAC" helper workflow).

**Use Webhook Chaining (fire-and-forget, async handoff):**
- WF-1 → WF-2 (after content_ready): WF-1 does not need to wait for media generation.
  WF-1 calls WF-2's webhook with `{ topicId }` and returns immediately. WF-2 runs
  independently on its own schedule anyway, so this is just an early trigger.
- Dashboard → WF-1: The dashboard fires a webhook and gets an immediate 200 response.
  Execution state is tracked via topics.status in Supabase, not by holding the HTTP
  connection open.

**Use Execute Sub-Workflow (async, do NOT wait):**
- WF-2 spawning parallel media tasks per topic: use Execute Sub-Workflow with
  "Wait for Sub-Workflow Completion = OFF" to fan out thumbnail, carousel, music
  branches in parallel without blocking the parent loop.

### n8n Community Consensus (confirmed by research)

- One webhook per workflow. Never stack multiple webhook triggers in a single workflow.
  Doing so causes memory bloat (entire workflow loads on every request), ambiguous
  execution history, and race conditions.
- Sub-workflows are the correct pattern for shared logic. They run in the same n8n
  process, pass JSON cleanly, and the parent can optionally wait.
- For content pipelines specifically, the recommended architecture is:
  one orchestrator (WF-1), independent specialized workers (WF-2, WF-4), a shared
  utility sub-workflow (WF-3), and a sweeper/poller (WF-5).

---

## Async Operation Handling

HeyGen renders take 5-10 minutes. Blotato short-form videos take 2-5 minutes.
Both return a job ID immediately. n8n's 64-second webhook timeout makes waiting
in-line impossible. The correct architecture uses the Sweeper pattern (WF-5).

### Pattern A: Scheduled Sweeper (Recommended for this system)

WF-5 runs every 10 minutes via n8n Cron. It:
1. Queries Supabase (via HTTP Request to Next.js or direct Postgres) for all
   `content_pieces` where `heygen_status = 'processing'` or `blotato_status = 'processing'`.
2. For each row, polls the vendor API (HeyGen `GET /v1/video_status.get?video_id=`,
   Blotato `GET /api/videos/{id}`).
3. On completion, calls the HMAC-protected `n8n-asset-callback` Edge Function to
   write the video URL and update piece status.
4. On failure, resets the job ID and increments `retry_count` so WF-2 can re-submit
   on its next run.

This matches the existing `check-status` cron logic and is the simplest to operate.
The n8n `Wait` node is NOT used here — it holds the workflow execution in memory for
the full 5-10 minutes and does not survive n8n restarts on Windows.

### Pattern B: Wait Node with Webhook Resume (Alternative, more complex)

WF-2 submits a HeyGen job, then hits a `Wait` node configured to resume on webhook.
HeyGen would need to call back to n8n's resume URL when rendering completes.
HeyGen does NOT support configurable callbacks in its basic API tier, making this
pattern inapplicable without a proxy layer. Avoid for now.

### Pattern C: n8n Loop + Delay (Last resort)

WF-2 polls HeyGen in a loop with a `Wait` node set to "After Time Interval = 60s"
between checks. This keeps the execution alive in memory. Max wait for n8n cloud is
uncapped; for self-hosted Windows, if n8n restarts (e.g., update, reboot), the
in-progress execution is lost. Not recommended for production.

### Decision

Use Pattern A (Sweeper via WF-5). The existing `check-status` cron logic maps
directly. WF-5 replaces that Vercel cron with identical business logic in n8n nodes,
calling the same Next.js routes or querying Supabase directly.

### Handling n8n Restarts on Windows

Self-hosted n8n on a local Windows machine may restart (updates, reboots). Design
for this:
- Never store critical state inside n8n workflow data. All state lives in Supabase.
- WF-5 (sweeper) is stateless: it reads from DB, acts, writes to DB. A restart just
  means one missed poll cycle — the next run 10 minutes later picks up where it left off.
- WF-2 (media) is idempotent: it skips pieces already in `processing` status, so a
  duplicate run after restart does not double-submit jobs.

---

## Component Boundaries

### What lives in n8n

n8n's job is orchestration, scheduling, and fan-out. It should NOT contain business logic.

| Responsibility | Lives in n8n |
|---|---|
| Cron scheduling (replace Vercel crons) | YES |
| Webhook entry points (dashboard-triggered flows) | YES |
| Polling loop for async jobs (HeyGen, Blotato) | YES (WF-5 sweeper) |
| Parallel fan-out (submit all media types for a topic) | YES |
| Routing decisions (which topics need what) | YES (simple IF nodes) |
| API key storage for Next.js / Supabase calls | YES (n8n credentials) |
| Error alerting / Slack notification | YES (n8n built-in) |
| Retry scheduling (re-queue failed pieces) | YES |

### What stays in Next.js

All service-client logic and business logic stay in Next.js API routes. This preserves
type safety, testability, and the existing service abstractions.

| Responsibility | Lives in Next.js |
|---|---|
| Claude prompt building + API call (claude.ts) | YES |
| ElevenLabs TTS (elevenlabs.ts) | YES |
| HeyGen job submission + status check (heygen.ts) | YES |
| Blotato video + publish (blotato.ts) | YES |
| Canva autofill + export (canva.ts) | YES |
| OpenAI / Gemini image gen (openai.ts, gemini.ts) | YES |
| Supabase Storage uploads (storage.ts) | YES |
| Cost tracking inserts | YES (called from API routes) |
| Workflow lock acquire/release | YES (workflow-lock.ts) |
| Duplicate topic checking (pg_trgm RPC) | YES |
| Voice LRU rotation RPC | YES |
| Evergreen content scheduling logic | YES |

### What lives in Supabase Edge Functions

Edge Functions are the write-back layer that n8n can reach from anywhere (public HTTPS,
no tunnel dependency). n8n should ONLY call Edge Functions for status/data writes after
async operations complete.

| Responsibility | Lives in Edge Functions |
|---|---|
| Status write-back (topic, asset, publish, research) | YES (4 existing callbacks) |
| HMAC signature validation | YES (_shared/hmac.ts) |
| Lightweight DB mutations triggered by n8n | YES |
| Heavy computation / API calls | NO — use Next.js routes |

### Key design principle: n8n never calls external APIs directly

n8n calls Next.js API routes, and Next.js calls external services (Claude, HeyGen, etc.).
This means:
- API keys for Claude, HeyGen, ElevenLabs, etc. live in Vercel environment variables,
  not in n8n credentials.
- If an external service changes its API, only the Next.js service client needs updating.
- The existing TypeScript types, Zod schemas, and error handling in Next.js are reused.
- n8n's role stays purely: trigger → call route → handle response → call Edge Function.

The one exception is Supabase: n8n can query Supabase directly (via the n8n Supabase node
or HTTP Request to the REST API) for read-only lookups like "which topics need processing."
This avoids a round-trip through Next.js for simple SELECT queries.

---

## Suggested Build Order

Build leaf-first (no dependencies), then workers, then orchestrator.

### Phase 1 — Foundation (build these first, they have no upstream dependencies)

**WF-5: Status Poller** — Build first.
- Replaces `check-status` Vercel cron.
- Entirely self-contained: query Supabase for processing pieces, poll vendor APIs via
  Next.js routes, write results via Edge Functions.
- Zero dependencies on other workflows.
- Can be tested immediately against real data (existing processing jobs in DB).
- Build and run it alongside the existing check-status Vercel cron; compare results;
  disable Vercel cron once confident.

**WF-3: Research Sub-Workflow** — Build second.
- Self-contained leaf: receives a topic_id, does web research, calls n8n-research-callback.
- Can be tested by manually triggering it with a known topic_id.
- Has no dependency on WF-1 existing yet.

### Phase 2 — Workers (build these after Phase 1 is stable)

**WF-4: Publish Pipeline** — Build third.
- Replaces `daily-publish` Vercel cron.
- Calls existing `/api/cron/daily-publish` route (already works) or per-topic publish route.
- Calls `n8n-publish-callback` Edge Function for each published piece.
- Depends only on Supabase data and existing Next.js routes — no WF-1 or WF-2 dependency.
- Test by scheduling a real topic and manually triggering the webhook.

**WF-2: Media Pipeline** — Build fourth.
- Replaces `daily-media` Vercel cron.
- Most complex workflow: 6 parallel branches per topic.
- Calls `/api/media/video`, `/api/media/thumbnail`, `/api/media/carousel`,
  `/api/media/podcast`, `/api/media/music`, `/api/media/voice`.
- Calls `n8n-asset-callback` for each completed synchronous asset.
- Relies on WF-5 (already built) for async video completion.
- Test with a topic in `content_ready` status.

### Phase 3 — Orchestrator (build last)

**WF-1: Topic Pipeline** — Build last.
- Webhook-triggered entry point for the entire pipeline.
- Calls `/api/topics/generate`, executes WF-3 as sub-workflow, calls
  `/api/topics/[id]/schedule`, then optionally fires WF-2's webhook.
- Depends on WF-3 (research sub-workflow) being stable.
- This is the workflow the dashboard "Generate & Schedule" button targets.

### Build Order Summary

```
WF-5 (Status Poller)      ← Week 1, no deps, replaces check-status cron
WF-3 (Research Sub-WF)    ← Week 1, no deps, new capability
WF-4 (Publish Pipeline)   ← Week 2, depends on Supabase data only
WF-2 (Media Pipeline)     ← Week 2-3, depends on WF-5 for async resolution
WF-1 (Topic Pipeline)     ← Week 3, depends on WF-3 as sub-workflow
```

Vercel crons are disabled one at a time as their n8n equivalent is verified:
1. Disable `check-status` cron after WF-5 is stable (≥ 48h of matched results)
2. Disable `daily-publish` cron after WF-4 is stable
3. Disable `daily-media` cron after WF-2 is stable

---

## Network / Tunnel Setup for Self-Hosted n8n

n8n runs on `localhost:5678` on a Windows machine. For Supabase Edge Functions (public HTTPS)
and HeyGen to call back into n8n's Wait node resume URLs, and for the Next.js dashboard on
Vercel to trigger n8n webhooks, a public tunnel is required.

**Recommended: Cloudflare Tunnel (cloudflared)**

```
winget install --id Cloudflare.cloudflared

# Named tunnel (persistent, free)
cloudflared tunnel create fhcontent-n8n
cloudflared tunnel route dns fhcontent-n8n n8n.yourdomain.com
cloudflared tunnel run fhcontent-n8n
```

This gives a stable `https://n8n.yourdomain.com` URL that routes to `localhost:5678`.

Set in n8n `.env`:
```
WEBHOOK_URL=https://n8n.yourdomain.com
N8N_HOST=0.0.0.0
N8N_PORT=5678
```

The dashboard stores this base URL in `NEXT_PUBLIC_N8N_WEBHOOK_BASE_URL` (Vercel env var).

**Fallback: ngrok (free tier, URL changes on restart)**
Suitable for development only. Production requires Cloudflare Tunnel or equivalent.

---

## HMAC Security Summary

The existing HMAC setup in `supabase/functions/_shared/hmac.ts` is well-designed:
- Shared secret stored as `N8N_WEBHOOK_SECRET` Supabase secret
- n8n Code node computes `HMAC-SHA256(secret, JSON.stringify(body))` and sets
  `X-N8N-Signature` header
- Edge Function validates with timing-safe comparison before any DB write

n8n does not have a native HMAC node as of 2026. Use a **Code node** in each
workflow that calls a Supabase Edge Function:

```javascript
// n8n Code node: compute HMAC-SHA256 for Edge Function callback
const crypto = require('crypto');
const secret = $env.N8N_WEBHOOK_SECRET;  // stored in n8n environment
const body = JSON.stringify($input.first().json);
const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
return [{ json: { body, signature: sig } }];
```

Store `N8N_WEBHOOK_SECRET` as an n8n Environment variable (Settings > Variables),
matching the value set in Supabase secrets.

---

## References

- [Execute Workflow vs Webhook Trigger (n8n Community)](https://community.n8n.io/t/execute-workflow-vs-webhook-trigger/259590)
- [Why You Shouldn't Cram Multiple Webhooks Into One n8n Workflow](https://www.piotr-sikora.com/blog/2026-01-10-n8n-architecture-why-multiple-webhooks-in-one-workflow-is-bad-idea)
- [Sub-workflows | n8n Docs](https://docs.n8n.io/flow-logic/subworkflows/)
- [Async Video Polling Engine workflow template](https://n8n.io/workflows/12684-async-video-polling-engine-background-job-handler-for-ai-video-generation/)
- [Wait node documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/)
- [State management for long-running workflows](https://n8n.io/workflows/6269-state-management-system-for-long-running-workflows-with-wait-nodes/)
- [Safer n8n Sub-workflows With The V2.0 Wait Node Fix](https://blog.nocodecreative.io/n8n-v2-wait-node-hitl-sub-workflows/)
- [Securely Put Your Self-Hosted n8n Workflows Online (ngrok)](https://ngrok.com/docs/universal-gateway/examples/n8n)
- [Free Self-Host AI Agents with n8n and Cloudflare Tunnel](https://itnext.io/free-self-host-ai-agent-workflows-with-n8n-and-cloudflare-tunnel-fddb9ae6282e)
- [Secure Your Automation Webhooks with Signature Verification](https://codehooks.io/blog/secure-zapier-make-n8n-webhooks-signature-verification)
- [Best n8n architecture for multi-account content automation](https://community.n8n.io/t/best-n8n-architecture-for-multi-account-content-automation/157601)
