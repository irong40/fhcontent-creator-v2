-- The claim judge (content-generator on Vercel cannot reach a local Ollama) runs through this
-- queue on qwen3:32b. 8b stays the default. Not applied by the branch: apply with the deploy.
-- Undo: alter table public.local_inference_jobs drop constraint local_inference_jobs_model_check,
--   add constraint local_inference_jobs_model_check check (model = 'qwen3:8b');  (only with no 32b rows)
alter table public.local_inference_jobs drop constraint if exists local_inference_jobs_model_check;
alter table public.local_inference_jobs add constraint local_inference_jobs_model_check check (model in ('qwen3:8b','qwen3:32b'));
