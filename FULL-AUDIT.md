# FULL AUDIT — fix/topic-settle-freeze (base: master)

**Auditor**: Codex (OpenAI), cross-model review of Claude Code work
**Date**: 2026-07-27
**Commit**: 9d0c337
**Reasoning effort**: xhigh

> Transcribed by Claude Code from the audit run output. Codex prepared this report but its
> `apply_patch` write was rejected — the workspace was mounted read-only for that session.
> Re-run with workspace write access if you want Codex to author the file itself.

## Verdict: REWORK

| Dimension | Grade | Critical | Important |
|---|---:|---:|---:|
| Code Quality | D | 2 | 2 |
| Security | A | 0 | 0 |
| Test Coverage | D | 1 | 2 |

## Critical findings

**1. Accepted retries discard their prior `retry_count`.**
Every later failure resets the count to 1, so the five-attempt limit never expires. This can
cause hourly resubmissions and duplicate posts.
- `src/app/api/cron/daily-publish/route.ts:215`
- `src/app/api/cron/check-status/route.ts:214`

> This is the 2026-06-02 / 2026-07-15 duplicate-publish incident class. It is the single
> reason this branch must not merge as-is.

**2. An expired `partially_published` topic remains eligible for settlement during a manual retry.**
check-status can re-condemn the restored piece before publishing begins, because preparation
changes `publish_at` but not the status or the partial-topic `published_at` anchor.
- `src/app/api/topics/[id]/publish/prepare.ts:94`
- `src/app/api/cron/check-status/settle.ts:211`

**3. The 523 passing tests do not exercise either real transition.**
They inject `retry_count` into `pending` rows the publisher never creates, and manually flip
the topic to `publishing` in test memory after skipping the unsafe concurrency interval.

## Important findings

- **Publish Now** does nothing for future scheduled topics and returns success with zero submissions.
- Supabase errors and zero-row compare-and-set results are ignored, allowing false success
  responses and downstream newsletter/COO actions for state that was never persisted.
- No tests cover database errors, lost races, or the complete manual-publish route.

## Verification performed

| Gate | Result |
|---|---|
| Vitest | 523 passed |
| ESLint (changed files) | 0 errors |
| `git diff --check` | passed |
| npm audit (cached) | 0 vulnerabilities; live registry blocked |
| Typecheck | only the 3 accepted pre-existing TS1501 errors |
| Production build | NOT verified — sandbox blocked junction creation and network |

## Assessment

The cross-model audit earned its keep. Two same-family adversarial rounds (9 then 11
blocking/major issues) did not catch finding #1, which is a regression into the exact
duplicate-publishing failure the branch's own design constraints were written to prevent.

Note the asymmetry worth remembering: **Security graded A, Code Quality and Test Coverage
graded D.** The defects are correctness and test-honesty, not vulnerabilities. And the
headline number — 523 passing tests — was rated misleading by the auditor, which matches
the pattern from round 1, where a green suite accompanied a fix that provably did not work.

## Status

Branch remains **local, unpushed, unmerged**. Nothing in this audit affects production.
