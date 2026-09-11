# Ollama content routing — active September 11, 2026

Production: https://fhcontent-creator-v2.vercel.app
Verified deployment: https://fhcontent-creator-v2-87js7b128-faith-harmony.vercel.app

## Active scope

CONTENT_INFERENCE_PROVIDER=ollama is set in production. The scheduled content-generator now queues local jobs instead of calling the hosted text model for standard six-piece generation and quote captions. No automatic hosted fallback exists. Other generation endpoints, research/source retrieval, imagery, audio and publishing services keep their existing providers.

The service-only Supabase migration is applied in qjpujskwqaehxnqypxzu as version 20260911201146, name local_inference_jobs. The local migration filename was aligned with the version assigned by the management API, without modifying the applied SQL. Row-level security and denied anon/authenticated table/claim privileges were verified live.

Windows task **FHContent Local Inference Worker** is Running. It starts hidden at this user's logon and was manually started for this activation. Source: scripts/start-local-inference-worker.ps1. Logs: logs/local-inference-worker.log and logs/local-inference-worker.error.log. It runs under the logged-in user's session; the PC must be on and that session available. Ollama must be running. A stopped/asleep PC leaves work queued.

The worker processes one job at a time through fixed local qwen3:8b, with 300-second leases and bounded inference attempts. Temporary network/queue-service failures retry after 30 seconds; authentication failures stop immediately. The model does not call tools, media providers or publishers. Wrong or expired lease tokens cannot complete a job.

## Live acceptance evidence

1. Hosted caption fixture succeeded on first attempt: 61 input / 25 output tokens.
2. Representative six-piece fixture succeeded with six distinct pieces: 2238 input / 4534 output tokens, 67.3 seconds. It copied an existing published source read-only; its generated drafts are unapproved.
3. Deployed cron created a durable job for one clearly marked internal topic dated 2099-12-31. A client/network timeout interrupted the request, but the job persisted. The restarted hidden worker claimed and completed it on attempt 1: 2266 input / 3759 output tokens.
4. A second production cron invocation returned HTTP 200, consumed the result and inserted six pieces together. Live database assertions confirmed status=content_ready, requires_review=true, approved_at=null, coo_auto_approved_at=null, all six pieces pending, and an Ollama cost row with zero hosted inference dollars.
5. The internal topic, its six content pieces and its test cost row were deleted using the exact fixture ID and test-hash guard. Database verification returned zero remaining fixture rows. Queue records and local evidence are retained.
6. Final production cron check returned HTTP 200, processed=0, No drafts to drain. The worker is Running and idle with empty error log.

Evidence: docs/ollama-activation-evidence-2026-09-11.json, docs/local-inference-hosted-smoke-2026-09-11.json, docs/local-inference-content-smoke-2026-09-11.json.

## Review behavior and practical limits

Local content becomes content_ready with a human-review hold. Scheduled media and publishing skip it. The review page provides **Approve text for media**, requires a signed-in human, records reviewer/time and leaves content_ready. Final media approval and scheduling remain separate. Recovery of existing pieces also holds for review. Manual media APIs retain their existing authorization; this rollout does not redesign authorization for every manual endpoint.

The sample long script was 264 words against a prompt target of 500–800. Structural validation and correct routing do not prove writing quality, factual support, or full duration compliance. Human review must correct these before media approval. No factual authority or publication permission is conferred by model output or passing schema validation.

Standard local jobs reserve 6144 output tokens; quote caption jobs reserve 4096. All 30 sampled recent prompts fit the conservative input/output context bound. No source truncation occurs; larger jobs fail visibly. Bounded text/image-prompt fields and repeat_penalty=1.1 prevent the observed repeated-image-instruction loop. An earlier isolated failed fixture is retained as failed with an explicit superseded-test error.

New Zod JSON Schema objects carry a non-enumerable ~standard adapter containing functions. The queue now sends only enumerable schema fields; regression coverage uses the real content schema. This fixed a defect that simple hand-written schema fixtures did not expose.

## Verification and source state

- 518 tests pass across 29 files; full TypeScript check passes.
- Both production deployments built successfully. Final cloud activation build passed before the later host-only connection-recovery update; that worker update passed focused tests and typecheck and is running locally.
- Changed code ESLint has no errors; existing image-tag/unused-import warnings and Next middleware deprecation remain.
- SQL grants, lease rejection/recovery/exhaustion were execution-tested in isolated PostgreSQL before hosted deployment.
- No paid inference, media generation, outbound messages or publishing was manually triggered for these tests. Test zero-dollar rows do not measure electricity or total operating cost.
- The production cloud app is deployed. Local source changes have not been pushed to Git; preserve this checkout when doing later releases.

Rollback is explicit: set CONTENT_INFERENCE_PROVIDER=claude and redeploy if requested. Preserve queue evidence and review holds. Never silently fall back, discard uncertain jobs, or clear holds for convenience.
