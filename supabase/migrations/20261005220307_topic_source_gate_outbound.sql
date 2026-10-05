-- Applied to project qjpujskwqaehxnqypxzu on 2026-10-05 as version 20261005220307.
--
-- Adam, 2026-10-05: "have codex review the enitre project", then "yes" to closing the holes
-- it found. The first gate (20261004232349_topic_source_gate.sql) stopped a topic from being
-- approved, scheduled or sent to publishing without a passing source check. The review, and a
-- read of the live data, found four ways around it:
--
--   1. The publish step posted first and set the status afterwards, so the refusal came after
--      the post. The app now asks public.topic_source_cleared before anything leaves
--      (src/lib/source-gate.ts). This migration adds that function.
--   2. published and partially_published were not gated, so a topic could jump straight there.
--   3. A topic already approved or scheduled could be given a date, or have its review hold
--      cleared, with no check: its status did not change, so the trigger did not look. Eight
--      History Unveiled VA topics scheduled before the gate existed sat in exactly that state.
--   4. source_verified = true skipped the check even when a newer check had failed, and a
--      signed-in session could set it in the same statement that approved the topic.
--
-- The rule now, in one sentence: a topic is cleared when its newest source check is a pass,
-- or when it has no check at all and the app's server marked it source_verified (the
-- NotebookLM guardrail). A fail always blocks.
--
-- A topic that is already out (publishing, partially_published, published) may still settle
-- among those three states. It may not go back to approved or scheduled without a pass.
--
-- To undo: restore the function body from 20261004232349_topic_source_gate.sql and
--          drop function public.topic_source_cleared(uuid);

create function public.topic_source_cleared(p_topic uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when n.verdict = 'pass' then true
    when n.verdict is not null then false
    else coalesce((select t.source_verified from public.topics t where t.id = p_topic), false)
  end
  from (
    select (
      select c.verdict
      from public.topic_source_checks c
      where c.topic_id = p_topic
      order by c.checked_at desc
      limit 1
    ) as verdict
  ) n;
$$;

comment on function public.topic_source_cleared(uuid) is
  'True when the topic may go out: its newest source check is a pass, or it has no check and is source_verified. The app asks this before it posts anything.';

revoke all on function public.topic_source_cleared(uuid) from public, anon, authenticated;
grant execute on function public.topic_source_cleared(uuid) to service_role;

create or replace function public.enforce_topic_source_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  newest text;
  needs_check boolean := false;
  caller text := coalesce(auth.role(), '');
begin
  -- Only the app's server or an administrator may mark a topic source_verified.
  if coalesce(new.source_verified, false)
     and (tg_op = 'INSERT' or not coalesce(old.source_verified, false))
     and caller in ('anon', 'authenticated') then
    raise exception
      'Source check required. source_verified cannot be set from a signed-in session (topic %).', new.id
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    needs_check := new.status in ('approved', 'scheduled', 'publishing', 'partially_published', 'published');
  else
    needs_check :=
      -- clearing the text review hold (this starts the paid render, or frees a scheduled topic)
      (old.requires_review is true and new.requires_review is not true
         and new.status in ('content_ready', 'approved', 'scheduled'))
      -- moving toward publication, or straight to a published state from outside
      or (new.status is distinct from old.status and (
            new.status in ('approved', 'scheduled')
            or (new.status in ('publishing', 'partially_published', 'published')
                and old.status not in ('publishing', 'partially_published', 'published'))))
      -- giving a date or a time to a topic that is already approved or scheduled
      or (new.status in ('approved', 'scheduled')
          and (new.publish_date is distinct from old.publish_date or new.publish_at is distinct from old.publish_at)
          and (new.publish_date is not null or new.publish_at is not null));
  end if;

  if needs_check is false then
    return new;
  end if;

  select c.verdict into newest
  from public.topic_source_checks c
  where c.topic_id = new.id
  order by c.checked_at desc
  limit 1;

  if newest = 'pass' or (newest is null and coalesce(new.source_verified, false)) then
    return new;
  end if;

  raise exception
    'Source check required. Topic % has % and cannot be reviewed, approved, scheduled, dated or published. The source validator checks each text against outside sources; see agent-office/content/fh-content.',
    new.id,
    case when newest = 'fail' then 'failed its source check' else 'no source check yet' end
    using errcode = 'P0001';
end;
$$;

revoke all on function public.enforce_topic_source_check() from public, anon, authenticated;