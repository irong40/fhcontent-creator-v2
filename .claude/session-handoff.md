# Session Handoff
**Date:** 2026-07-18
**Branch:** master

## Accomplished
- Diagnosed why social metrics stopped: `performance_metrics` had no rows since 7/10; every `analytics-pull` cron run stored ZERO snapshots (verified by invoking prod cron: `pieces_scanned:227, snapshots:0, insertErrors:234`).
- Root cause (two independent defects, both confirmed against live Blotato):
  1. Collector read `GET /posts/{id}/analytics`, which returns empty `metrics:{}` / 404 even for posts with real metrics. Real engagement is inline on `GET /v2/analytics`.
  2. Blotato returns metrics as STRINGS ("1049"); `mapMetrics` used a `typeof==='number'` guard → mapped everything to 0.
- Ruled OUT RLS/service-role (daily-publish uses the same admin client and writes fine in prod).
- Fixed & shipped (commit `b310849`, pushed, deployed prod `dpl_Am5Wgv...` READY):
  - `blotato.ts`: added `listTopPosts()` on `GET /v2/analytics`; string-tolerant metrics type.
  - `analytics-pull.ts`: reads inline metrics unioned across sort keys, string coercion, URL-normalized join, split counters + sample errors, `notifyError` on zero-snapshot runs.
  - `supabase/server.ts`: `.trim()` on admin env values.
  - `analytics-pull.spec.ts`: new tests (8/8 pass). Lint + tsc clean.
- **Verified in prod**: cron run wrote 75 snapshots, `insertErrors:0` (YouTube 58/812 views, Twitter 14/69, TikTok 3/9). Rows confirmed in DB.

## Next Steps
- Let the daily 15:00 UTC cron backfill: `unmatched:281` shrinks as Step 1 resolves post URLs (capped 80/run) over the next few days. Optionally bump the cap or re-run the cron to accelerate.
- Build the `/admin/social` dashboard (separate, larger task) on top of the now-flowing data — mirror the `BdIntelligence` Recharts pattern, leading indicators (retention, engagement rate, shares/saves).
- `social_post_metrics` table is still 0 rows / no writer — decide if it's still wanted or drop it.

## Known Issues
- `@sentinelaerialinspector` Part 107 high-view posts won't match here — they publish via the separate quiz-shorts pipeline, not this app's `content_pieces`.
- Blotato coverage: only ~111 posts had metrics this run; grows as Blotato's background collector widens.
- Pre-existing tsc errors in `src/lib/prompts.spec.ts` (regex flag, unrelated).

## Key Decisions
- Use `GET /v2/analytics` (top posts, inline metrics) as the engagement source, not the per-post analytics endpoint.
- Union 4 sort keys (views/likes/comments/reach) to widen coverage past the 100-item, no-cursor cap.
- Alert (via `notifyError`) whenever pieces are scanned but zero snapshots stored.

## Uncommitted Changes
- None in source — all analytics changes committed (`b310849`) and pushed. Only `.claude/` state files updated by this qend.
