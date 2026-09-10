-- Per-account rolling-window post counter, for the daily-publish 24h cap guard.
--
-- Context: the 2026-07-15/16 failure cluster was a catch-up storm blowing past
-- YouTube's 10-uploads/24h/account and TikTok's OpenAPI spam limit. The guard in
-- daily-publish defers a platform once its account is at the cap instead of
-- firing a doomed submission. It needs a count of how many posts we've already
-- put through a given ACCOUNT in the window — but published_platforms stores the
-- platform + status, not the accountId, so we join back through the persona's
-- platform_accounts map. Accounts are shared across personas, so we count across
-- every persona mapping that accountId on that platform.
--
-- Only 'published' and 'pending' (successfully submitted / in-flight) entries
-- count — a 'failed' attempt never consumed the provider's quota.

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
          nullif(e.st ->> 'published_at', '')::timestamptz,
          cp.published_at,
          cp.created_at
        ) >= now() - make_interval(hours => p_hours);
$$;
