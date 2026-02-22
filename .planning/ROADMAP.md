# Roadmap: Content Command Center — Stabilization

**Milestone:** v1.0-stabilization
**Phases:** 5
**Requirements:** 13
**Depth:** Standard
**Coverage:** 13/13

---

## Phases

- [ ] **Phase 1: Build Fix** - Restore the ability to deploy anything
- [ ] **Phase 2: Deployment Hardening** - Eliminate Vercel timeout and URL construction failures
- [ ] **Phase 3: Podcast & RSS** - Make the RSS feed serve real episodes
- [ ] **Phase 4: Pipeline Reliability** - Recover stuck topics, wire digest email, guard voice ID
- [ ] **Phase 5: Security & Data** - Lock down unauthenticated endpoints and unify cost data

---

## Phase Details

### Phase 1: Build Fix

**Goal**: The production build completes without errors so any subsequent fix can be deployed.
**Depends on**: Nothing (first phase)
**Requirements**: BUILD-01

**Success Criteria** (what must be TRUE):
  1. `next build` runs to completion with zero TypeScript errors
  2. Supabase Edge Function types (Deno) do not appear in the Next.js compilation output or diagnostics
  3. A Vercel deployment triggered after this fix succeeds at the build step without errors

**Plans**: TBD

---

### Phase 2: Deployment Hardening

**Goal**: Every heavy API route has an appropriate timeout and the Vercel URL is always constructed correctly.
**Depends on**: Phase 1
**Requirements**: BUILD-02, BUILD-03

**Success Criteria** (what must be TRUE):
  1. Voice, video, thumbnail, carousel, content-generate, and topic-generate routes each export an explicit `maxDuration` value — none default to the 10s Vercel hobby plan limit
  2. When `NEXT_PUBLIC_SITE_URL` is unset on Vercel and `VERCEL_URL` is set, `daily-media` constructs `https://<VERCEL_URL>` — the string `https://undefined` never appears in logs
  3. A local verification test with `NEXT_PUBLIC_SITE_URL` unset and `VERCEL_URL` set produces a valid URL

**Plans**: TBD

---

### Phase 3: Podcast & RSS

**Goal**: The RSS feed serves real podcast episodes with correct episode numbers and per-episode artwork.
**Depends on**: Phase 1
**Requirements**: RSS-01, RSS-02, RSS-03

**Success Criteria** (what must be TRUE):
  1. When a topic transitions to `published`, its associated `podcast_episode` row is promoted from `ready` to `published` — the RSS feed returns at least one `<item>` element for a published topic
  2. The `<itunes:episode>` tag in each RSS item contains a sequential integer, not a UUID — Apple Podcasts displays episodes in creation order
  3. Each RSS `<item>` element contains an `<itunes:image>` tag pointing to the content piece thumbnail for that episode

**Plans**: TBD

---

### Phase 4: Pipeline Reliability

**Goal**: The pipeline recovers automatically from stuck states, notifies the operator daily, and refuses to create topics with an invalid voice configuration.
**Depends on**: Phase 1
**Requirements**: PIPE-01, PIPE-02, PIPE-03

**Success Criteria** (what must be TRUE):
  1. A topic that has been in `content_generating` status for more than 15 minutes is automatically reset to a retriable state by the next `check-status` cron run — no manual database intervention needed
  2. At the end of every `daily-publish` cron run, the operator receives a digest email summarizing publishes, costs, and errors — no manual dashboard check is required for daily operational awareness
  3. Submitting a topic-generate request for a persona with no voices configured returns HTTP 400 — the literal string `'default'` is never written to the `voice_id` column

**Plans**: TBD

---

### Phase 5: Security & Data

**Goal**: Unauthenticated API access is blocked, the development cron bypass is visible in logs, expired DALL-E image URLs never reach Blotato, and cost history is unified under a single service name.
**Depends on**: Phase 1
**Requirements**: SEC-01, SEC-02, SEC-03, DATA-01

**Success Criteria** (what must be TRUE):
  1. A request to `/api/analytics/pull` without a valid session returns HTTP 401 — unauthenticated callers cannot trigger Blotato API calls
  2. Starting the development server without `CRON_SECRET` set emits a console warning — the auth bypass is explicit, not silent
  3. The quick-post flow uploads the DALL-E image to Supabase Storage before passing any URL to Blotato — no OpenAI CDN URLs (which expire in ~1 hour) are sent directly to Blotato
  4. The `cost_tracking` table contains zero rows with `service = 'anthropic'` after the migration runs — the cost dashboard shows a single unified `claude` line item for all historical Claude spend

**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Build Fix | 0/? | Not started | - |
| 2. Deployment Hardening | 0/? | Not started | - |
| 3. Podcast & RSS | 0/? | Not started | - |
| 4. Pipeline Reliability | 0/? | Not started | - |
| 5. Security & Data | 0/? | Not started | - |

---

*Roadmap created: 2026-02-22*
