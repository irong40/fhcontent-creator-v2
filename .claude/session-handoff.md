# Session Handoff
**Date:** 2026-04-19
**Branch:** master

## Accomplished
- Diagnosed why Dr. Imani Carter never posts — no daily topic generation cron existed; topics only created manually
- Built `/api/cron/daily-topic` route: fetches `AUTO_TOPIC_PERSONA_IDS` env var, generates 1 topic per persona via Claude (with duplicate check, LRU voice, guardrail), then immediately generates all 6 content pieces
- Added `daily-topic` to `vercel.json` cron schedule at 2 AM daily (4 hrs before `daily-media` at 6 AM)
- Scoped cron to Dr. Imani Carter only via `AUTO_TOPIC_PERSONA_IDS=6ac9adfa-27f1-492b-98e1-f5623cb4eda2` in `.env.local`
- Manually ran Dr. Carter's Jackson Ward / Maggie Walker topic through the pipeline today:
  - Content generated via GPT-4o (Claude spend cap blocked until 2026-05-01)
  - 6 pieces inserted — hit silent failure on `content_channel` column (not in DB schema); fixed by removing it from insert
  - 4 short video jobs submitted to Blotato; long video skipped (no HeyGen avatar on persona)
  - Topic approved + scheduled for 2026-04-19

## Next Steps
- **Deploy to Vercel** — `daily-topic` cron not yet deployed; push to activate it
- **Add `AUTO_TOPIC_PERSONA_IDS` to Vercel env vars** (production): `6ac9adfa-27f1-492b-98e1-f5623cb4eda2`
- **Add GPT-4o fallback to `daily-topic` cron** — currently uses Claude natively; will fail until May 1 spend cap resets
- **Fix `content_channel` column** — in TypeScript types but missing from DB; add migration or remove from types
- **Verify Dr. Carter posted today** — check Blotato jobs completed + daily-publish fired
- **Add HeyGen avatar to Dr. Carter persona** if long-form video is wanted
- Raise Anthropic spend cap at `console.anthropic.com → Limits` (or wait for May 1 reset)

## Known Issues
- **Claude API spend cap** — blocks all Claude-dependent generation until 2026-05-01
- **`content_channel` column** — in `database.ts` types but not in Supabase schema; inserts silently fail with PGRST204
- **Dr. Carter has no HeyGen avatar** — long piece created but never rendered
- **Gemini API key** on free tier — rate-limited, unusable for text generation

## Key Decisions
- `AUTO_TOPIC_PERSONA_IDS` env var pattern chosen over DB flag — no schema change needed, easy to extend
- GPT-4o used as manual one-off fallback; daily-topic cron uses Claude natively (works post-May 1)
- Long video skipped rather than erroring — Blotato shorts sufficient for today's publish

## Uncommitted Changes
- `vercel.json` — added daily-topic cron entry
- `src/middleware.ts` — modified (pre-existing changes)
- `src/app/api/cron/daily-topic/route.ts` — new file (not committed)
- Multiple new scripts: `insert-carter-pieces.ts`, `submit-carter-media.ts`, `check-carter.ts`, `get-topic-id.ts`, etc.
