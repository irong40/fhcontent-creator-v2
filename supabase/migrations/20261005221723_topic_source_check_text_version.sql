-- Applied to project qjpujskwqaehxnqypxzu on 2026-10-05 as version 20261005221723.
--
-- Adam, 2026-10-05: "yes" to the open items from the Codex review, starting with tying a pass
-- to the text it checked.
--
-- Until now a source check belonged to a topic. A text could pass, then have a caption
-- remixed or a script regenerated, and the old pass still cleared it. Now a check belongs to
-- one version of the text:
--
--   topic_text_hash      one fingerprint for everything a topic says: its title, hook and
--                        points, and each piece's title, script, captions and carousel slide
--                        words. Media addresses, image prompts and statuses are left out, so a
--                        render does not change it.
--   content_hash         the fingerprint the check read, stored on the check row. The office
--                        prints it for the validator as "Text version:" and files it back.
--   topic_source_state   pass     the newest check passed this exact text
--                        changed  the text is not the one the newest check read
--                        fail     the newest check failed this text
--                        verified no check, and the server marked it source_verified
--                        none     no check
--   topic_source_cleared true for pass and verified. The app asks this before it renders or
--                        posts anything (src/lib/source-gate.ts).
--
-- The trigger applies the same rule to the row being written, so approving, scheduling,
-- dating or clearing the review of a topic whose text changed after its check is refused.
-- Editing the text of a scheduled topic is not refused: the edit goes through, the topic is
-- no longer cleared, and the publish step will not send it until it is checked again.
--
-- A fail whose text has since changed also reads 'changed', so a rewritten text goes back
-- for a check instead of staying failed for ever.
--
-- To undo: restore both function bodies from 20261005220307_topic_source_gate_outbound.sql,
--          drop the six new functions, and drop the column.

alter table public.topic_source_checks add column content_hash text;

comment on column public.topic_source_checks.content_hash is
  'The version of the topic''s text this check read (public.topic_content_hash at the time). A pass clears only that version.';

create function public.topic_text_hash(p_topic uuid, p_title text, p_hook text, p_points jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select md5(
    coalesce(p_title, '') || chr(31) || coalesce(p_hook, '') || chr(31) || coalesce(p_points::text, '') || chr(30) ||
    coalesce((
      select string_agg(
        coalesce(cp.piece_type, '') || chr(31) || coalesce(cp.title, '') || chr(31) || coalesce(cp.script, '') || chr(31) ||
        coalesce(cp.caption_long, '') || chr(31) || coalesce(cp.caption_short, '') || chr(31) ||
        coalesce((
          select string_agg(coalesce(s.value ->> 'text', ''), chr(29) order by s.ordinality)
          from jsonb_array_elements(case when jsonb_typeof(cp.carousel_slides) = 'array' then cp.carousel_slides else '[]'::jsonb end)
               with ordinality as s(value, ordinality)), ''),
        chr(30) order by cp.piece_order, cp.piece_type, cp.id)
      from public.content_pieces cp
      where cp.topic_id = p_topic), ''));
$$;

comment on function public.topic_text_hash(uuid, text, text, jsonb) is
  'One fingerprint for everything a topic says: its title, hook and points, and each piece''s title, script, captions and carousel slide words. Media addresses, image prompts and statuses are left out, so a render does not change it.';

create function public.topic_content_hash(p_topic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.topic_text_hash(t.id, t.title, t.hook, t.historical_points) from public.topics t where t.id = p_topic;
$$;

create function public.topic_source_state(p_topic uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when n.verdict is null then
      case when coalesce((select t.source_verified from public.topics t where t.id = p_topic), false) then 'verified' else 'none' end
    when n.content_hash is not null and n.content_hash is distinct from public.topic_content_hash(p_topic) then 'changed'
    when n.verdict = 'pass' and n.content_hash is not null then 'pass'
    when n.verdict = 'pass' then 'changed'
    else 'fail'
  end
  from (values (1)) v(x)
  left join lateral (
    select c.verdict, c.content_hash
    from public.topic_source_checks c
    where c.topic_id = p_topic
    order by c.checked_at desc
    limit 1
  ) n on true;
$$;

comment on function public.topic_source_state(uuid) is
  'pass: the newest check passed this exact text. changed: the text is not the one the newest check read. fail: the newest check failed this text. verified: no check, and the server marked it source_verified. none: no check.';

create or replace function public.topic_source_cleared(p_topic uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.topic_source_state(p_topic) in ('pass', 'verified');
$$;

-- Read as columns through the API: topics?select=id,source_state,text_version
create function public.source_state(t public.topics)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.topic_source_state(t.id);
$$;

create function public.text_version(t public.topics)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.topic_content_hash(t.id);
$$;

revoke all on function public.topic_text_hash(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.topic_content_hash(uuid) from public, anon, authenticated;
revoke all on function public.topic_source_state(uuid) from public, anon, authenticated;
revoke all on function public.topic_source_cleared(uuid) from public, anon, authenticated;
revoke all on function public.source_state(public.topics) from public, anon, authenticated;
revoke all on function public.text_version(public.topics) from public, anon, authenticated;
grant execute on function public.topic_text_hash(uuid, text, text, jsonb) to service_role;
grant execute on function public.topic_content_hash(uuid) to service_role;
grant execute on function public.topic_source_state(uuid) to service_role;
grant execute on function public.topic_source_cleared(uuid) to service_role;
grant execute on function public.source_state(public.topics) to service_role;
grant execute on function public.text_version(public.topics) to service_role;

create or replace function public.enforce_topic_source_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  newest text;
  newest_hash text;
  why text;
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

  select c.verdict, c.content_hash into newest, newest_hash
  from public.topic_source_checks c
  where c.topic_id = new.id
  order by c.checked_at desc
  limit 1;

  if newest is null then
    if coalesce(new.source_verified, false) then
      return new;
    end if;
    why := 'no source check yet';
  elsif newest_hash is not null
        and newest_hash is distinct from public.topic_text_hash(new.id, new.title, new.hook, new.historical_points) then
    why := 'text that changed after its source check';
  elsif newest = 'pass' and newest_hash is not null then
    return new;
  elsif newest = 'pass' then
    why := 'a pass that names no text version';
  else
    why := 'failed its source check';
  end if;

  raise exception
    'Source check required. Topic % has % and cannot be reviewed, approved, scheduled, dated or published. The source validator checks each text against outside sources; see agent-office/content/fh-content.',
    new.id, why
    using errcode = 'P0001';
end;
$$;

revoke all on function public.enforce_topic_source_check() from public, anon, authenticated;
