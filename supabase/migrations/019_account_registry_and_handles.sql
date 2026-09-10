-- Account-complete metrics: attribute every snapshot to the ACCOUNT a post
-- landed on (its @handle), so brands with different purposes are tracked apart
-- and the separate-pipeline accounts (Sentinel's Part 107 TikTok) are captured
-- too. Applied live via MCP on 2026-07-18; this file version-controls it.

-- Registry: Blotato accountId -> handle/brand/purpose.
create table if not exists public.blotato_accounts (
  account_id text primary key,
  platform   text not null,
  handle     text not null,
  brand      text not null,
  purpose    text
);

insert into public.blotato_accounts (account_id, platform, handle, brand, purpose) values
  ('5294','tiktok','@faithharmony04','Faith & Harmony','Black history + music'),
  ('51301','tiktok','@northeastcorner1','North East Corner','Masonic education'),
  ('51302','tiktok','@sentinelaerialinspector','Sentinel Aerial','Part 107 training'),
  ('1290','youtube','They Never Told Us','Faith & Harmony','Black history'),
  ('28719','youtube','NorthEast Corner','North East Corner','Masonic education'),
  ('30796','youtube','Faith Harmony (SAI)','Sentinel Aerial','Part 107 / music'),
  ('1182','youtube','Adam Pierce','Cybersecurity','Cyber'),
  ('4346','instagram','@faithharmony4045','Faith & Harmony','Black history + music'),
  ('1506','threads','@faithharmony4045','Faith & Harmony','Black history + music'),
  ('1478','twitter','@apiercea45','Faith & Harmony','Cyber / history'),  -- @-handles lowercased to match URL-derived handles
  ('3684','facebook','Adam Pierce (pages)','Multi','Mixed')
on conflict (account_id) do update set
  handle = excluded.handle, brand = excluded.brand, purpose = excluded.purpose, platform = excluded.platform;

-- performance_metrics gains an account handle + Blotato post id; content_piece_id
-- becomes nullable so separate-pipeline posts (never in content_pieces) can be stored.
alter table public.performance_metrics add column if not exists handle text;
alter table public.performance_metrics add column if not exists blotato_post_id text;
alter table public.performance_metrics alter column content_piece_id drop not null;
create index if not exists idx_perf_handle on public.performance_metrics(handle);
create index if not exists idx_perf_blotato on public.performance_metrics(blotato_post_id) where blotato_post_id is not null;

-- One-time backfill of existing rows via persona -> platform_accounts -> registry.
update performance_metrics pm
set handle = ba.handle
from content_pieces cp
join topics t on t.id = cp.topic_id
join personas pr on pr.id = t.persona_id,
     blotato_accounts ba
where pm.content_piece_id = cp.id
  and ba.account_id = (pr.platform_accounts ->> pm.platform)
  and pm.handle is null;

-- Re-run after each collector pass to attribute new content_piece snapshots.
create or replace function public.backfill_metric_handles()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  update performance_metrics pm
  set handle = ba.handle
  from content_pieces cp
  join topics t on t.id = cp.topic_id
  join personas pr on pr.id = t.persona_id,
       blotato_accounts ba
  where pm.content_piece_id = cp.id
    and ba.account_id = (pr.platform_accounts ->> pm.platform)
    and pm.handle is null;
  get diagnostics n = row_count;
  return n;
end; $$;

-- Per-account performance from stored history (latest snapshot per post).
create or replace function public.get_account_performance(p_days integer default 30)
returns table(handle text, brand text, purpose text, platform text,
              posts bigint, views bigint, likes bigint, comments bigint, shares bigint, saves bigint, last_post timestamptz)
language sql stable set search_path to 'public' as $$
  with latest as (
    select distinct on (coalesce(pm.content_piece_id::text, pm.blotato_post_id), pm.platform)
      pm.handle, pm.platform, pm.views, pm.likes, pm.comments, pm.shares, pm.saves, pm.captured_at
    from performance_metrics pm
    where pm.captured_at >= now() - make_interval(days => p_days) and pm.handle is not null
    order by coalesce(pm.content_piece_id::text, pm.blotato_post_id), pm.platform, pm.captured_at desc
  )
  select l.handle, coalesce(ba.brand,''), coalesce(ba.purpose,''), l.platform,
         count(*)::bigint, sum(l.views)::bigint, sum(l.likes)::bigint, sum(l.comments)::bigint,
         sum(l.shares)::bigint, sum(l.saves)::bigint, max(l.captured_at)
  from latest l left join blotato_accounts ba on ba.handle = l.handle
  group by l.handle, ba.brand, ba.purpose, l.platform
  order by sum(l.views) desc;
$$;
