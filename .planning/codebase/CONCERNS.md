# Codebase Concerns

**Analysis Date:** 2026-02-22

---

## Tech Debt

**Pervasive `as unknown as` Type Cast Pattern:**
- Issue: 22 occurrences of `as unknown as` throughout the codebase — used to bridge Supabase's generated types with runtime shapes. Most stem from Supabase's typed client not inferring joined relations correctly.
- Files: `src/app/api/cron/daily-media/route.ts:76`, `src/app/api/cron/daily-publish/route.ts:87,88`, `src/app/api/content/generate/route.ts:36,87`, `src/app/api/topics/generate/route.ts:101`, `src/app/api/media/podcast/route.ts:85`, and 15+ others
- Impact: Defeats TypeScript type safety in DB interaction layer. A schema change will not produce compile errors — runtime crashes instead.
- Fix approach: Create proper typed join helpers or use Supabase's `InferDbRow` utility types for joined queries. At minimum, document which casts are intentional.

**`voice_id: voiceId || 'default'` Fallback in Topic Generation:**
- Issue: When `get_lru_voice` RPC returns null (empty voice pool), `voice_id` is set to the literal string `'default'`. ElevenLabs will reject this as an invalid voice ID.
- Files: `src/app/api/topics/generate/route.ts:103,119`
- Impact: Topics created with empty voice pool will fail TTS generation silently when the daily-media cron runs.
- Fix approach: Guard before insert — return 400 if persona has no voices configured; or document that voice pool must be populated before topic generation.

**Uncommitted Production Code (Large Diff):**
- Issue: `git status` shows 16 modified files + 17 untracked files on master. This includes 7 migrations, 4 Edge Functions, analytics routes, podcast routes, evergreen/workflow-lock libs, and the Phase 6 features.
- Files: Across entire `src/` and `supabase/` trees
- Impact: No audit trail. If something breaks in production, there is no way to `git bisect` or roll back.
- Fix approach: Commit all working code. Tag the stabilization milestone.

**Podcast Episode Status Never Promoted to `published`:**
- Issue: `podcast_episodes` rows are inserted with `status: 'ready'` by `src/app/api/media/podcast/route.ts:157`. The RSS feed at `src/app/api/podcast/rss/[brandId]/route.ts:52` filters by `.eq('status', 'published')`. No code in the codebase ever updates `podcast_episodes.status` to `'published'`.
- Files: `src/app/api/media/podcast/route.ts`, `src/app/api/podcast/rss/[brandId]/route.ts`, `src/app/api/cron/check-status/route.ts` (no podcast promotion logic)
- Impact: RSS feed is permanently empty. Apple Podcasts and Spotify will never receive episodes.
- Fix approach: Either promote podcast episodes to `'published'` when the parent topic publishes (add to `check-status` promotion logic), or set `status: 'published'` at insert time.

**Historical `'anthropic'` Cost Rows in Production:**
- Issue: Early cost tracking used `service: 'anthropic'`. Fixed to `service: 'claude'` (task_plan Phase 1 M4), but existing rows in the production `cost_tracking` table still use the old name.
- Files: `src/app/costs/page.tsx` (cost aggregation queries)
- Impact: Cost dashboard shows Claude spend split across two line items. Historical data is under-reported under `claude`.
- Fix approach: Run a one-time SQL update: `UPDATE cost_tracking SET service = 'claude' WHERE service = 'anthropic';` as a new migration (008).

**`estimateDuration` Uses 150 WPM (Still Present in Utils):**
- Issue: `estimateDuration()` in `src/lib/utils.ts:18` still estimates at 150 wpm. This function is used in the review UI to show script duration. podcast route now uses buffer-size estimation for `duration_seconds`, but the UI display is still based on 150 wpm.
- Files: `src/lib/utils.ts:17-21`, `src/app/review/[topicId]/page.tsx` (wherever `estimateDuration` is called)
- Impact: Duration shown in review UI will not match actual audio duration for ElevenLabs output (typically faster than 150 wpm).
- Fix approach: Low priority. Accept the discrepancy or update the wpm constant to ~165 (closer to ElevenLabs output rate).

---

## Known Bugs

**Lyria Music Generation — No Fallback (H5, Unresolved):**
- Symptoms: Music bed silently missing from published content. `daily-media` cron logs `[Lyria] Music generation failed` or `Music generation skipped for ... — Lyria unavailable` without alerting or retrying with a fallback.
- Files: `src/lib/gemini.ts:137-208`, `src/app/api/cron/daily-media/route.ts:393-427`
- Trigger: Lyria RealTime `lyria-realtime-exp` is experimental. Connection drops, no audio received, or API unavailable.
- Workaround: Two attempts are made (`daily-media` lines 404-406) but both can fail. No fallback music source exists.
- Status: **Unresolved** — marked H5 in PRD. Decision between AceStep 1.5 local fallback or accepting graceful skip is pending.

**Podcast RSS Feed — Always Empty:**
- Symptoms: RSS feed returns valid XML with zero `<item>` elements.
- Files: `src/app/api/podcast/rss/[brandId]/route.ts:52`, `src/app/api/media/podcast/route.ts:157`
- Trigger: `podcast_episodes.status` is never set to `'published'`. RSS query filters by that status.
- Workaround: Manually run SQL: `UPDATE podcast_episodes SET status = 'published' WHERE status = 'ready';`

**Self-Calling HTTP in `daily-media` Cron — URL Construction Bug:**
- Symptoms: When `NEXT_PUBLIC_SITE_URL` is unset and `VERCEL_URL` is set, the URL ternary resolves incorrectly.
- Files: `src/app/api/cron/daily-media/route.ts:443-445`
- Trigger: The expression is `process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL ? \`https://${process.env.VERCEL_URL}\` : 'http://localhost:3000'`. Due to operator precedence, if `NEXT_PUBLIC_SITE_URL` is empty and `VERCEL_URL` is set, this evaluates the ternary using the empty string as the condition, not `VERCEL_URL`. Result: `https://undefined` as the site URL.
- Workaround: Set `NEXT_PUBLIC_SITE_URL` explicitly in Vercel environment variables.
- Fix approach: `const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? \`https://${process.env.VERCEL_URL}\` : 'http://localhost:3000');`

**RSS Feed `<itunes:episode>` Uses UUID Instead of Sequential Number:**
- Symptoms: Apple Podcasts may display episodes out of order or ignore the episode number.
- Files: `src/app/api/podcast/rss/[brandId]/route.ts:97`
- Trigger: `<itunes:episode>${escapeXml(ep.id)}</itunes:episode>` uses the UUID primary key instead of a sequential integer.
- Fix approach: Add an `episode_number` column to `podcast_episodes` (migration 008), or compute order from `created_at` in the RSS query.

**RSS Feed — No `<itunes:image>` Per Episode:**
- Symptoms: Apple Podcasts shows generic channel artwork for all episodes (no per-episode artwork).
- Files: `src/app/api/podcast/rss/[brandId]/route.ts:90-99`
- Trigger: `<itunes:image>` tag is missing from `<item>` elements. Apple Podcasts strongly recommends per-episode images.
- Fix approach: Link `thumbnail_url` from the corresponding `content_pieces.long` piece as episode artwork.

---

## Security Considerations

**All API Routes Use Service Role Key (RLS Bypass):**
- Risk: Every server-side API route creates a `createAdminClient()` using `SUPABASE_SERVICE_ROLE_KEY`, which bypasses Row Level Security entirely. There is no row-level authorization — any request that passes authentication can read/write any record.
- Files: `src/lib/supabase/server.ts:31-44`, used across 50+ route handlers
- Current mitigation: Auth middleware (`src/middleware.ts`) redirects unauthenticated users to `/login`. Cron routes protected by `CRON_SECRET`.
- Recommendations: This is acceptable for a single-operator internal tool, but adds risk if the app is ever exposed to additional users. Document the design decision explicitly. Ensure `SUPABASE_SERVICE_ROLE_KEY` is only set server-side (never as `NEXT_PUBLIC_`).

**Cron Endpoints Open Without Authentication in Development:**
- Risk: `validateCronSecret()` returns `true` when `CRON_SECRET` is unset. In development without that var, anyone who can reach the dev server can trigger media generation (ElevenLabs, HeyGen, DALL-E costs).
- Files: `src/app/api/cron/middleware.ts:8-9`
- Current mitigation: Only a risk in development. Production on Vercel always has `CRON_SECRET` set.
- Recommendations: Log a warning when `CRON_SECRET` is unset instead of silently bypassing auth.

**`/api/analytics/pull` Has No Authentication:**
- Risk: The analytics pull endpoint is a POST route with no auth check and no cron secret. Any unauthenticated caller can trigger Blotato API calls (rate limit exhaustion).
- Files: `src/app/api/analytics/pull/route.ts:13`
- Current mitigation: Auth middleware should protect this via `src/middleware.ts`. Verify the middleware matcher covers `/api/analytics/*`.
- Recommendations: Add explicit auth check at the top of the handler (same pattern as cron secret check) for defense in depth.

**Quick Post Route — Inline DALL-E Call Without Auth Token Expiry Check:**
- Risk: `src/app/api/content/quick-post/route.ts:57-79` constructs a raw fetch to `api.openai.com` using `process.env.OPENAI_API_KEY`. The DALL-E-generated image URL (from OpenAI's CDN) is passed directly to Blotato for publishing without validation. OpenAI image URLs expire in ~1 hour.
- Files: `src/app/api/content/quick-post/route.ts:57-79`
- Impact: If Blotato is slow to process, the expired URL causes silent publish failure.
- Fix approach: Download the image immediately and upload to Supabase Storage before passing to Blotato (same pattern as `daily-media` cron).

**n8n HMAC Secret — Missing from `.env.example` Warning Still Relevant:**
- Risk: Edge Functions (`supabase/functions/`) return 401 with `"Server misconfiguration: missing webhook secret"` if `N8N_WEBHOOK_SECRET` is not set in Supabase Edge Function secrets. This is a different secret store from Vercel env vars.
- Files: `supabase/functions/_shared/hmac.ts:40-42`
- Current mitigation: Added to `.env.example` (Phase 1 H7 fix). But Supabase Edge Function secrets must be set separately via `supabase secrets set`.
- Recommendations: Add to deployment runbook. The `.env.example` fix only covers the Next.js layer.

---

## Performance Bottlenecks

**`daily-media` Cron — Sequential Per-Persona Delay:**
- Problem: `daily-media` processes personas sequentially with a 5-second delay between each (`await new Promise(resolve => setTimeout(resolve, 5000))`). For multiple active personas, total runtime scales linearly.
- Files: `src/app/api/cron/daily-media/route.ts:70-73`
- Cause: Anti-rate-limit measure baked in as a fixed delay regardless of actual API limits.
- Current capacity: 1 persona = up to ~4 min; 6 personas = up to ~24 min (exceeds 15-min workflow lock TTL).
- Improvement path: Replace fixed delay with per-API rate-limit tracking. Use `Promise.allSettled` for independent stages across personas.

**`check-status` — N+1 Query Pattern for Platform Resolution:**
- Problem: `pollBlotatoStatuses()` loops over every publishing piece, then for each piece loops over every platform status, calling `blotato.getPostStatus()` per platform. For 7 topics × 6 pieces × 6 platforms = 252 sequential HTTP calls every 10 minutes.
- Files: `src/app/api/cron/check-status/route.ts:178-316`
- Cause: Blotato API has no batch status endpoint — each post status requires an individual call.
- Improvement path: Run platform status checks in parallel with `Promise.allSettled`. Limit concurrency with a semaphore.

**`daily-media` — Sequential Thumbnail Generation:**
- Problem: Thumbnails for all content pieces (up to 6 per topic × N topics) are generated one by one.
- Files: `src/app/api/cron/daily-media/route.ts:254-307`
- Cause: Simple `for` loop without parallelization.
- Improvement path: Parallelize with `Promise.allSettled`, respecting DALL-E rate limits (~5 req/min on standard tier).

**RSS Feed — Parallel HEAD Requests Block Response:**
- Problem: `api/podcast/rss/[brandId]/route.ts` fires HEAD requests to all episode audio URLs in parallel (`Promise.all`) before returning the feed. For 50+ episodes, this blocks the response for the duration of all HEAD calls.
- Files: `src/app/api/podcast/rss/[brandId]/route.ts:71-79`
- Cause: Podcast spec requires `<enclosure length>` byte count, which isn't stored.
- Improvement path: Store `audio_size_bytes` in `podcast_episodes` table at upload time. Eliminate the HEAD request pattern entirely.

---

## Fragile Areas

**`daily-media` Cron — Self-HTTP Call for Podcast Generation:**
- Files: `src/app/api/cron/daily-media/route.ts:446`
- Why fragile: The cron calls itself via HTTP (`fetch(\`${siteUrl}/api/media/podcast\`, ...)`) rather than calling the underlying function directly. This introduces network latency, a second HTTP roundtrip, and fails silently if the URL is misconfigured (see bug above).
- Safe modification: Extract podcast generation logic to a shared function in `src/lib/podcast.ts`. Call it directly from both the cron and the `/api/media/podcast` route.
- Test coverage: No tests for the self-call path.

**Evergreen Content System — Mutates `published_at` on Re-schedule:**
- Files: `src/lib/evergreen.ts:83-89`
- Why fragile: `fillEvergreenGaps()` sets `status: 'scheduled'` on a previously-published evergreen topic. When `check-status` later runs, it may promote this topic back to `published` and overwrite `published_at` with the new publish date. Historical publish data is lost.
- Safe modification: Add an `evergreen_republish_count` counter column and a separate `last_republished_at` timestamp. Don't overwrite `published_at`.
- Test coverage: No tests for evergreen republish behavior.

**Workflow Lock — Race Condition on Cleanup + Reacquire:**
- Files: `src/lib/workflow-lock.ts:14-26`
- Why fragile: `acquireLock()` first deletes expired locks, then inserts a new lock. Between the delete and insert, another concurrent cron execution could also delete expired locks and insert its own lock. The `UNIQUE` constraint will reject the second insert, which is correct behavior. However, if the first insert fails for a non-`23505` reason (DB connection issue), the function returns null and the workflow is blocked until the 15-minute TTL expires.
- Safe modification: Acceptable risk given Vercel's single-execution-per-cron guarantee. Document the assumption.

**`carousel_url` Dual-Format Storage:**
- Files: `src/app/api/cron/daily-media/route.ts:365-371`, `src/app/api/cron/daily-publish/helpers.ts` (inferred)
- Why fragile: `carousel_url` stores either a plain URL string (1 slide) or a JSON array string (multiple slides). `getCarouselUrls()` helper must handle both formats. Any code reading `carousel_url` that does not use that helper will break for multi-slide carousels.
- Safe modification: Always store as JSON array (`JSON.stringify([url])` for single slides). Migration needed for existing rows.
- Test coverage: Covered by helpers.spec.ts.

**`check-status` — Newsletter Draft Uses Unguarded `JSON.parse`:**
- Files: `src/app/api/cron/check-status/route.ts:371`
- Why fragile: `generateNewsletterDrafts()` calls `JSON.parse(jsonText)` directly. If Claude returns malformed JSON, this throws inside a `try/catch` that only logs the error. The newsletter draft is silently skipped with no notification.
- Safe modification: Extract to the same try/catch/return pattern used in other routes (podcast, carousel). Already fixed in those routes; missed here.

---

## Scaling Limits

**Vercel Function Timeout — 300s Hard Limit:**
- Current capacity: `maxDuration = 300` set on cron routes and podcast route. Media routes (voice, video, thumbnail, carousel) have **no `maxDuration` set** — they default to Vercel's 10s limit on hobby plans, 60s on pro.
- Limit: ElevenLabs podcast TTS for a 5000-word script can take 60-90s. Thumbnail generation from DALL-E is 15-30s. These routes will time out on Vercel Pro without explicit `maxDuration`.
- Files missing `maxDuration`: `src/app/api/media/voice/route.ts`, `src/app/api/media/video/route.ts`, `src/app/api/media/thumbnail/route.ts`, `src/app/api/media/carousel/route.ts`, `src/app/api/content/generate/route.ts`, `src/app/api/topics/generate/route.ts`
- Scaling path: Add `export const maxDuration = 60;` (or higher) to each heavy route. Verify Vercel plan supports the duration.

**Multi-Brand Scaling — `daily-media` Processes All Personas:**
- Current capacity: Designed for 1 active persona (History Unveiled VA). The PRD plans 6 total brands.
- Limit: 6 personas × 7 topics × sequential processing = the cron will run well past its 300s max duration.
- Scaling path: Shard processing — run separate cron invocations per persona, or use a queue (Supabase Edge Functions + pgmq) to distribute work.

**`performance_metrics` — No Native Platform APIs:**
- Current capacity: Table exists but will remain empty because Blotato provides no engagement data.
- Limit: Without Instagram Graph API, TikTok Business API, or YouTube Data API, analytics are permanently unavailable.
- Scaling path: Integrate native platform APIs as a future phase. This requires OAuth token storage per platform account.

---

## Dependencies at Risk

**`@google/genai` — Lyria RealTime is Experimental:**
- Risk: `lyria-realtime-exp` model is experimental and undocumented. It has been unreliable in production (H5 issue). API contract may change without notice.
- Impact: Music generation is a production workflow step. Silent failures degrade content quality.
- Migration plan: Decide on AceStep 1.5 as a self-hosted fallback, or officially accept music-free content and remove the Lyria generation code to reduce complexity.

**`@breezystack/lamejs` — Custom MP3 Encoding in Serverless:**
- Risk: Running MP3 encoding (CPU-intensive) inside a Vercel serverless function alongside Lyria's WebSocket connection is an unusual pattern. `@breezystack/lamejs` is a maintained fork but niche.
- Files: `src/lib/gemini.ts:7`, `src/lib/gemini.ts:pcmToMp3()`
- Impact: If Lyria is replaced with a REST-based API, the entire PCM→MP3 encoding pipeline becomes unnecessary.
- Migration plan: Remove if Lyria is replaced. No risk if Lyria is kept.

**Blotato — No Engagement Metrics in API Response:**
- Risk: Blotato's `getPostStatus` returns only `id, status, createdAt, publishedAt, error, platformPostId`. The `performance_metrics` table is permanently empty.
- Impact: `hook_performance` tracking (planned feature) has no data source. Cost-per-engagement calculations are impossible.
- Migration plan: Monitor Blotato API changelog for engagement metric support. Fallback: use native platform APIs for Instagram Graph, TikTok Business, YouTube Data.

---

## Missing Critical Features

**Podcast Episode Status Promotion:**
- Problem: No mechanism exists to move a `podcast_episode` from `ready` to `published`. The RSS feed only serves `published` episodes. This is a production blocker for podcast distribution.
- Blocks: Apple Podcasts, Spotify feed delivery.

**No Retry/Recovery for Content Generation Failures:**
- Problem: If Claude content generation fails mid-topic (e.g., API timeout), the topic is left in `content_generating` status with no recovery path. The daily-media cron only processes `content_ready`, `approved`, and `scheduled` topics — not stuck `content_generating` ones.
- Files: `src/app/api/content/generate/route.ts:40-43`, `src/app/api/cron/daily-media/route.ts:41`
- Blocks: Reliable unattended operation across 7 topics per week.

**No Daily Digest Email:**
- Problem: `sendDailyDigest()` exists in `src/lib/email.ts` but is never called. No code triggers a daily summary of publishes, costs, and errors.
- Files: `src/lib/email.ts:104-131`, `src/app/api/cron/daily-publish/route.ts` (no digest call)
- Blocks: Operational visibility without manually checking the dashboard.

---

## Test Coverage Gaps

**API Route Handlers — Zero Direct Tests:**
- What's not tested: None of the 21 API route handlers have unit tests. Only the `daily-publish` route has integration-style tests (`publish.spec.ts`) that test the exported `publishTopic` function, not the full HTTP handler.
- Files: `src/app/api/content/`, `src/app/api/topics/`, `src/app/api/media/`, `src/app/api/cron/check-status/route.ts`, `src/app/api/cron/daily-media/route.ts`
- Risk: Error handling paths (malformed Claude JSON, Supabase insert failures, external API timeouts) are untested. The known bugs in RSS feed and podcast status promotion were not caught by tests.
- Priority: High

**Supabase Edge Functions — Zero Tests:**
- What's not tested: All 4 n8n callback functions (`n8n-topic-callback`, `n8n-research-callback`, `n8n-asset-callback`, `n8n-publish-callback`).
- Files: `supabase/functions/n8n-topic-callback/index.ts`, `supabase/functions/n8n-research-callback/index.ts`, `supabase/functions/n8n-asset-callback/index.ts`, `supabase/functions/n8n-publish-callback/index.ts`
- Risk: HMAC validation, status update logic, and error handling in these callbacks are untested. A misconfigured `N8N_WEBHOOK_SECRET` will silently reject all n8n callbacks.
- Priority: Medium

**Evergreen Logic — No Tests:**
- What's not tested: `fillEvergreenGaps()` behavior — particularly the LRU selection, the `status: 'scheduled'` mutation, and the re-query flow in `daily-publish`.
- Files: `src/lib/evergreen.ts`
- Risk: An evergreen topic could be re-scheduled over an existing scheduled topic if the date check has an edge case.
- Priority: Medium

**Frontend Pages — No Tests:**
- What's not tested: All 8 frontend pages (`/plan`, `/review/[topicId]`, `/personas`, `/calendar`, `/costs`, `/`).
- Files: `src/app/` (all page.tsx files)
- Risk: UI regressions (broken approve/schedule flows, media generation buttons) go undetected.
- Priority: Low (single operator, manual QA sufficient)

---

*Concerns audit: 2026-02-22*
