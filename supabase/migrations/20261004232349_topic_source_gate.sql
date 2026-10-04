-- Applied to project qjpujskwqaehxnqypxzu on 2026-10-04 as version 20261004232349.
--
-- Adam, 2026-10-04: "lets just make sure its validated from here on out", then "Yes" to
-- applying this block. An outside source check of the 17 History Unveiled VA texts waiting
-- for his review found no point supported by any source
-- (obsidian-dev/agent-office/content/fh-content/2026-10-04-huva-source-check.md).
--
-- From here on, a topic cannot have its text review cleared, and cannot be approved,
-- scheduled or sent to publishing, unless its newest source check is a pass. The office's
-- source validator files those checks (agent-office/cron-agents/lib/fh_content_queue.py
-- --record). The content app never writes to topic_source_checks.
--
-- What the app will see: an update that is refused raises P0001 with a message that starts
-- "Source check required." The review-text route, the approve route, the schedule route,
-- content-generator (when the writer is Claude, which lands a topic as scheduled) and
-- daily-publish all go through this.
--
-- To undo: drop trigger topics_source_check on public.topics;
--          drop function public.enforce_topic_source_check();
--          (the table can stay; it is only a record)

create table public.topic_source_checks (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  verdict text not null check (verdict in ('pass', 'fail')),
  points_total integer not null check (points_total >= 0),
  points_supported integer not null check (points_supported >= 0 and points_supported <= points_total),
  record_path text not null,
  summary text,
  checked_by text not null,
  checked_at timestamptz not null default now(),
  constraint topic_source_checks_pass_means_every_point
    check (verdict <> 'pass' or (points_total > 0 and points_supported = points_total)),
  constraint topic_source_checks_one_per_moment unique (topic_id, checked_at)
);

comment on table public.topic_source_checks is
  'One row per outside source check of an fh-content topic. The newest row for a topic decides. Written by the office (source-validator), never by the content app.';

create index topic_source_checks_topic_idx
  on public.topic_source_checks (topic_id, checked_at desc);

-- No policies: only the service role reads or writes this table.
alter table public.topic_source_checks enable row level security;

create function public.enforce_topic_source_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  newest text;
  needs_check boolean := false;
begin
  if tg_op = 'INSERT' then
    needs_check := new.status in ('approved', 'scheduled', 'publishing');
  else
    needs_check :=
      -- clearing the text review hold on a finished text (this starts the paid render)
      (old.requires_review is true and new.requires_review is not true and new.status = 'content_ready')
      -- or moving toward publication
      or (new.status is distinct from old.status and new.status in ('approved', 'scheduled', 'publishing'));
  end if;

  if not needs_check or coalesce(new.source_verified, false) then
    return new;
  end if;

  select c.verdict into newest
  from public.topic_source_checks c
  where c.topic_id = new.id
  order by c.checked_at desc
  limit 1;

  if newest is distinct from 'pass' then
    raise exception
      'Source check required. Topic % has % and cannot be reviewed, approved, scheduled or published. The source validator checks each text against outside sources; see agent-office/content/fh-content.',
      new.id,
      case when newest = 'fail' then 'failed its source check' else 'no source check yet' end
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_topic_source_check() from public, anon, authenticated;

create trigger topics_source_check
  before insert or update on public.topics
  for each row execute function public.enforce_topic_source_check();
