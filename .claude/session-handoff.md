# Session Handoff
**Date:** 2026-07-19 (session spanned 7/18 evening)
**Branch:** master (HEAD 70db1ad, deployed prod READY)

## Accomplished
- **/admin/social account-first dashboard + recommendations panel** (migs 018/019): per-@handle performance via `blotato_accounts` registry + `get_account_performance`; winners ranked by weighted engagement; cross-account recommendations (scale/resonates/rethink/fix/blindspot). Live-verified in browser.
- **Publish failures root-caused & fixed** (072d7c5, mig 020): Blotato failures come back as `errorMessage` (we read `.error` → all masked as "Publishing failed"); real causes were provider quota walls (YT 10/24h, TikTok OpenAPI) from the 7/15 catch-up storm. Added rolling-24h per-account cap guard in `publish-limits.ts` — defers at cap, transient errors stay retryable.
- **Facebook publishing capability** (acf0f1b, mig 021): FB Reels target w/ pageId, per-persona `facebook_enabled` opt-in (default off). SAI Field Ops persona wired: FB page 899526466587385 + IG 59689; NE Corner IG 59691 → Tate/Avery (mig 022).
- **M2 quiz staged multi-platform** via new `src/scripts/ingest-quiz.ts`: 20 videos (rendered template B in sai-training) → Supabase Storage → scheduled topics, 3/day **7/21→7/27** to SAI YT+FB+IG. Shifted +1 day after routing audit found an external Blotato queue (M1→SAI FB 7/19-20, M1→SAI TikTok 7/19-23) colliding at identical timestamps.
- **Codex cross-model audit** (gpt-5.5, both repos): 12 findings, 11 fixed (70db1ad + mig 023): `submitted_at` cap anchoring, workflow lock on manual publish route, transient-retry ceiling, ingest orphan repair + DB-derived slot allocator, fail-closed counter, FB pageId trim, `facebook` in PublishedPlatforms; sai-training render exit codes + tmp/rename race + selector precedence.
- 370 tests green, tsc + lint clean on changed files, all 4 deploys verified READY on Vercel.

## Next Steps
- **Mon 7/21 ~9:05 AM ET: verify the first app-driven SAI publish** (YT+FB+IG) — check `/admin/social` + `published_platforms` facebook/instagram rows. First-ever FB/IG publish through this app.
- Adam decision: external M1→TikTok 51302 queue posts during the account's warm-up window (his 7/16 rule) — keep or cancel via `blotato_delete_schedule`.
- ~7/23: check whether Blotato collects metrics for the new IG accounts once posts exist; if not and IG numbers matter → scope IG Graph API.
- M3–M6 quiz: write questions (`/part107-quiz`) → `render-quiz.js --module N --template B` → `ingest-quiz.ts --module N --commit`. A/B verdict ~7/20 may switch template.
- Deferred from Codex review: DST hardcode in ingest slot times (fix before any post-November scheduling).

## Known Issues
- IG/Threads/FB engagement blind upstream (Blotato collects none) — publish health only.
- Both new IG accounts are day-old taking 3 API reels/day; pause lever = remove `instagram` from persona.
- Dormant legacy personas (Holloway/Ashford/Dr. Adam Pierce) point at F&H channels + dead config keys (`youtube_2`, `facebook_page`) — clean before reactivating.
- Pre-existing tsc errors in `src/lib/prompts.spec.ts` (es2018 regex flag) and lint errors in `src/scripts/*` (unrelated).
- Local Next build impossible on D: (exFAT junction failure) — Vercel build is the gate.

## Key Decisions
- In-pipeline hard cap (fail closed) instead of a monitoring agent for over-posting.
- FB publishing gated per-persona (`facebook_enabled`) so capability ≠ auto-posting for Masonic pages.
- Skip M1 FB backfill; M2-first (template B — loop views don't count as engaged since 2025).
- Quiz content routed through the app (not a standalone publisher) to inherit cap guard + dashboard.

## Uncommitted Changes
- None in this repo — all work committed & pushed (b310849…70db1ad). sai-training has pre-existing modified narration audio files (not from this session; render-script changes are committed).
