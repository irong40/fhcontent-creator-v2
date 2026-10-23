-- A hosted (Claude) draft held while its claim-judge jobs run. Added 2026-10-22.
--
-- Why: the content generator asks Claude for a draft on every cron run. A sourced draft then
-- waits for qwen3:32b judge jobs keyed by a hash of the draft's own text. Claude writes
-- different text each time, so every run enqueued NEW judge jobs and never read the finished
-- ones: Du Bois (dfe531cf) made 33 judge jobs from 09:32Z to 01:30Z on 2026-10-22/23, 13 of
-- them clean passes, and never moved. Holding the draft for its attempt lets the next run
-- read the same text and the finished verdict.
--
-- Service-role only, like local_inference_jobs. A row lives only while its attempt waits on
-- the judge: the route deletes a topic's rows when the attempt passes or fails.
-- Undo: drop table public.content_draft_holds;  (the route then calls Claude every run again)
create table public.content_draft_holds (
  request_key text primary key check (length(request_key) = 64),
  topic_id uuid not null references public.topics(id) on delete cascade,
  provider text not null check (provider = 'claude'),
  result_text text not null check (length(result_text) between 1 and 200000),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
alter table public.content_draft_holds enable row level security;
revoke all on public.content_draft_holds from public, anon, authenticated;
grant select, insert, update, delete on public.content_draft_holds to service_role;
create index content_draft_holds_topic_idx on public.content_draft_holds(topic_id);
