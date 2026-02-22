# Requirements: Content Command Center — Stabilization

**Defined:** 2026-02-22
**Core Value:** Every automated pipeline step completes reliably without silent failures

## v1 Requirements

Requirements for stabilization release. Each maps to roadmap phases.

### Build & Deployment

- [ ] **BUILD-01**: Production build (`next build`) completes without errors — Deno types excluded from TypeScript compilation
- [ ] **BUILD-02**: All media API routes have explicit `maxDuration` matching their expected execution time (voice, video, thumbnail, carousel, content generate, topic generate)
- [ ] **BUILD-03**: Site URL resolves correctly on Vercel when `NEXT_PUBLIC_SITE_URL` is unset — fix operator precedence bug in `daily-media` cron

### Podcast & RSS

- [ ] **RSS-01**: Podcast episodes are promoted from `ready` to `published` when parent topic publishes — RSS feed serves episodes
- [ ] **RSS-02**: RSS `<itunes:episode>` uses sequential integer instead of UUID — Apple Podcasts displays correct episode order
- [ ] **RSS-03**: RSS `<item>` includes `<itunes:image>` per episode linked to content piece thumbnail — Apple Podcasts shows episode-specific artwork

### Pipeline Reliability

- [ ] **PIPE-01**: Topics stuck in `content_generating` status for >15 minutes are automatically reset to a retriable state by `check-status` cron
- [ ] **PIPE-02**: `sendDailyDigest()` is called at end of `daily-publish` cron — operator receives daily summary of publishes, costs, and errors
- [ ] **PIPE-03**: `voice_id` field rejects literal `'default'` — topic generation returns 400 if persona has no voices configured instead of inserting invalid voice ID

### Security

- [ ] **SEC-01**: `/api/analytics/pull` endpoint validates authentication before processing — unauthenticated requests receive 401
- [ ] **SEC-02**: Cron middleware logs warning when `CRON_SECRET` is unset in development instead of silently bypassing auth
- [ ] **SEC-03**: Quick post route downloads DALL-E image to Supabase Storage before passing URL to Blotato — eliminates expired URL failures

### Data Integrity

- [ ] **DATA-01**: Historical cost tracking rows with `service: 'anthropic'` are migrated to `service: 'claude'` via new SQL migration — cost dashboard shows unified totals

## v2 Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Performance

- **PERF-01**: `check-status` polls Blotato statuses in parallel with concurrency limit instead of 252 sequential HTTP calls
- **PERF-02**: `daily-media` processes personas in parallel with per-API rate-limit tracking instead of fixed 5s delays
- **PERF-03**: RSS feed stores `audio_size_bytes` at upload time instead of firing HEAD requests per episode

### Test Coverage

- **TEST-01**: API route handlers have unit tests for error paths (malformed input, external API failures, DB insert failures)
- **TEST-02**: Supabase Edge Functions have tests for HMAC validation and callback routing
- **TEST-03**: Evergreen content logic has tests for LRU selection and republish behavior

### Tech Debt

- **DEBT-01**: Replace 22x `as unknown as` type casts with proper Supabase typed join helpers
- **DEBT-02**: Evergreen republish preserves `published_at` and tracks `last_republished_at` separately
- **DEBT-03**: `carousel_url` always stored as JSON array (migration for existing rows)

## Out of Scope

| Feature | Reason |
|---------|--------|
| n8n orchestration migration | Separate milestone (PROJECT.md already drafted) |
| Multi-brand scaling (6 personas) | Requires queue architecture, future milestone |
| Native platform analytics APIs | Blotato doesn't provide engagement data, future milestone |
| Frontend page tests | Single operator, manual QA sufficient |
| Lyria music fallback (AceStep) | Architectural decision pending, not a bug fix |
| `daily-media` self-HTTP call refactor | Fragile but working, defer to n8n milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUILD-01 | — | Pending |
| BUILD-02 | — | Pending |
| BUILD-03 | — | Pending |
| RSS-01 | — | Pending |
| RSS-02 | — | Pending |
| RSS-03 | — | Pending |
| PIPE-01 | — | Pending |
| PIPE-02 | — | Pending |
| PIPE-03 | — | Pending |
| SEC-01 | — | Pending |
| SEC-02 | — | Pending |
| SEC-03 | — | Pending |
| DATA-01 | — | Pending |

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 0
- Unmapped: 13

---
*Requirements defined: 2026-02-22*
*Last updated: 2026-02-22 after initial definition*
