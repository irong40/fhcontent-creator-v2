# Local inference queue worker

Run from the project root with Node and existing dependencies:

```
npx tsx scripts/local-inference-worker.ts --once
npx tsx scripts/local-inference-worker.ts --loop
```

Nothing starts automatically. `--once` claims at most one live queue job; use only when authorized to mutate that queue. `--loop` processes jobs serially, waits five seconds when idle, and stops after its current bounded request on SIGINT/SIGTERM. No public listener, startup task, media work, publication or cloud fallback is created.

Configuration loads `.env.local` then `.env` without overwriting existing process variables. Required existing variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The key is sent as `apikey`; only legacy JWT keys also use Authorization Bearer. Secrets, prompts and generated text never enter worker logs. Authentication HTTP 401/403 stops the worker immediately with diagnostic context; inspect service key/grants or local Ollama configuration before restarting.

Worker claims `claim_local_inference_job(p_worker_id)` and accepts zero/one row. Inference uses fixed `http://127.0.0.1:11434/api/chat`, fixed `qwen3:8b`, `think:false`, temperature zero, context 16384 and requested output up to 8192 tokens without silently reducing it. The 240-second inference deadline plus two bounded 10-second RPC requests fit inside the 300-second queue lease; a claimed lease with less than 270 seconds remaining is rejected before inference. No renewal. Model identity, completed stop reason, assistant role, nonempty bounded text and nonnegative integer token counts are checked. When response_schema exists, its JSON schema is compiled through installed Zod and the parsed JSON must validate; unsupported schema conversion fails before inference. Without a schema only text/identity/completion/token validation applies, so route callers must supply schemas for structured outputs.

Completion/failure uses `finish_local_inference_job` with the exact lease token, text and token counts, or a safe generic failure code. A false result stops the worker and never reports completion. Queue RPC controls retry/max attempts. A fixed OS-temp exclusive lock prevents multiple instances of this worker from overlapping; other model consumers still require coordination. After a crash, check the PID in `%TEMP%/fhcontent-local-inference-worker.lock` and verify no worker is running before removing a stale lock.

Tests: `npx vitest run src/lib/local-inference-worker.spec.ts` — 18 tests passed. Covers claim/completion lease, fixed local endpoint/model, idle, wrong model, incomplete/truncated generation, invalid token count/JSON/schema, stale lease completion, too-short lease, sb_secret headers, and auth stops. Live production claim/inference/finalization is intentionally left to the coordinating parent after migration approval/application; this worker has not mutated the production queue.

Semantic accuracy and source support remain caller/reviewer responsibilities. Validation does not approve content or authorize publication.

Review hardening: Worker field limits match queue (system 24000 characters, user 64000 characters), with combined UTF-8 input strictly limited to 24000 bytes before inference. The enqueue helper enforces the same combined limit. This bounds local context input rather than silently truncating it. Both RPC and Ollama HTTP response bodies are streamed with a one-MiB cap before JSON parsing; declared oversized responses are rejected and oversized streams are cancelled. Added six regression tests for 8192 output tokens, combined multibyte input, thirty-second lease reserve, declared/streamed response overflow, and ordinary bounded JSON.


Final context guard: combined prompt UTF-8 byte count + requested max_tokens + 512 chat-template reserve must be <=16384. This conservative byte-per-token bound may reject long six-piece source packets; worker does not trim sources or silently reduce output. With 8192 requested output tokens, combined prompt maximum is 7680 bytes. Matching SQL/enqueue guard is owned by queue implementation. Two boundary regressions added, taking worker suite to 20 passing tests.

## Activated September 11

Hosted RPC and deployed cron roundtrip verified; see ollama-queue-rollout.md. Windows task FHContent Local Inference Worker is installed at current-user logon, hidden, and running now. Temporary network failures retry after30seconds; auth errors still stop. Local standard content uses6144 output ceiling and repeat_penalty1.1, with field bounds. Error codes distinguish output limit from model/validation errors. Full suite518passes; worker21tests.
