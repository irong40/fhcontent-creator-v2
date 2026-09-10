-- Codex review 2026-07-18, Major 1: the cap counter timestamped a PENDING
-- submission via coalesce(published_at, cp.published_at, cp.created_at). A
-- backlog piece created days ago but submitted TODAY fell to created_at —
-- outside the 24h window — so active submissions went uncounted in exactly the
-- catch-up-storm scenario the cap exists for. daily-publish now stamps
-- `submitted_at` on each platform status at submission; prefer it here.
create or replace function public.count_recent_account_posts(
  p_platform   text,
  p_account_id text,
  p_hours      integer default 24
)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select count(*)::int
  from content_pieces cp
  join topics t   on t.id = cp.topic_id
  join personas pr on pr.id = t.persona_id
  cross join lateral jsonb_each(coalesce(cp.published_platforms, '{}'::jsonb)) as e(platform, st)
  where pr.platform_accounts ->> p_platform = p_account_id
    and e.platform = p_platform
    and (e.st ->> 'status') in ('published', 'pending')
    and coalesce(
          nullif(e.st ->> 'submitted_at', '')::timestamptz,
          nullif(e.st ->> 'published_at', '')::timestamptz,
          cp.published_at,
          cp.created_at
        ) >= now() - make_interval(hours => p_hours);
$$;
