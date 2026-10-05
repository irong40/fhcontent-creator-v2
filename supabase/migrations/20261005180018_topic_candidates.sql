-- Applied to project qjpujskwqaehxnqypxzu on 2026-10-05 as version 20261005180018.
--
-- Adam, 2026-10-05: "so maybe this needs a loop prompt because the blocks are so much higher
-- than I would expect", then "yes" to building it. 22 of 22 checked texts had failed their
-- source check: each topic was written from a model's memory in one pass.
--
-- The office now writes topics from real pages, in a loop a program judges: find the page,
-- write each point from a passage on it, check that the passage is on the page, fix or
-- drop, three rounds at most (obsidian-dev/agent-office/cron-agents/lib/fh_topic_loop.py).
-- A topic that passes is filed here. For a persona whose content_guardrail is 'sourced',
-- the weekly topic step takes its topics from this table and never asks a model for one
-- (src/lib/sourced-topics.ts).
--
-- personas.content_guardrail now has three values: 'none', 'notebooklm', 'sourced'.
-- Everything here is new: nothing is dropped or replaced.

create table public.topic_candidates (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  title text not null,
  hook text not null,
  historical_points jsonb not null,
  thumbnail_prompt text,
  status text not null default 'ready' check (status in ('ready', 'used', 'discarded')),
  rounds integer not null default 1 check (rounds between 1 and 3),
  record_path text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  topic_id uuid references public.topics(id) on delete set null,
  constraint topic_candidates_four_points
    check (jsonb_typeof(historical_points) = 'array' and jsonb_array_length(historical_points) = 4)
);

comment on table public.topic_candidates is
  'Topics written from real source pages by the office loop (agent-office/cron-agents/lib/fh_topic_loop.py). Each point carries the page address and the sentence it rests on. The content app reads ready rows for sourced personas and marks them used.';

create unique index topic_candidates_one_title on public.topic_candidates (persona_id, lower(title));
create index topic_candidates_ready on public.topic_candidates (persona_id, created_at) where status = 'ready';

-- No policies: only the service role reads or writes this table.
alter table public.topic_candidates enable row level security;
