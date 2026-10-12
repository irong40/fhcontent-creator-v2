-- Applied to project qjpujskwqaehxnqypxzu on 2026-10-12 as version 20261012165437.
-- Sourced History Unveiled VA prompts (SOURCE PASSAGE + SOURCE DISCIPLINE, c372d57) no longer
-- fit a one-byte-per-token bound. qwen3 measured 3.3+ bytes/token over all 31 completed jobs
-- (2026-10-12), so two bytes per token stays conservative at the same num_ctx 16384.
-- Same rule in src/lib/local-inference-queue.ts and scripts/local-inference-worker.ts.
-- Undo: alter table public.local_inference_jobs drop constraint local_inference_jobs_check1;
--       alter table public.local_inference_jobs add constraint local_inference_jobs_check1
--         check (octet_length(system_prompt) + octet_length(user_prompt) + max_tokens + 512 <= 16384);
alter table public.local_inference_jobs drop constraint local_inference_jobs_check1;
alter table public.local_inference_jobs add constraint local_inference_jobs_check1
  check (ceil((octet_length(system_prompt) + octet_length(user_prompt)) / 2.0) + max_tokens + 512 <= 16384);
