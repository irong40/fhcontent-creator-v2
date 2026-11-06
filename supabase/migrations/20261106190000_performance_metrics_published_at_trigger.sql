-- Fill performance_metrics.published_at from content_pieces when a row is
-- written or tied to a piece, so the collector needs no deploy for (a).
-- Adds a function and a trigger, and fills null published_at on existing rows
-- (the final UPDATE changes rows). Option 1 of the 2026-10-09 job, chosen by
-- the COO 2026-10-27 (draft was
-- 20261017150000_performance_metrics_published_at_trigger.sql.proposed).
-- Apply with the Supabase apply_migration tool, not `supabase db push`: live
-- migration versions differ from some local file names (e.g. 20261009150000).
-- Undo, all three:
--   drop trigger if exists trg_pm_fill_published_at on public.performance_metrics;
--   drop function if exists public.pm_fill_published_at();
--   update public.performance_metrics pm set published_at = null
--   from public.performance_metrics_bak_20261106 b
--   where b.id = pm.id and b.published_at is null and pm.published_at is not null;
--   (rows inserted after the backup keep their filled date; that is the trigger's job)
create or replace function public.pm_fill_published_at() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.published_at is null and new.content_piece_id is not null then
    select cp.published_at into new.published_at
    from public.content_pieces cp where cp.id = new.content_piece_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_pm_fill_published_at on public.performance_metrics;
create trigger trg_pm_fill_published_at
before insert or update of content_piece_id on public.performance_metrics
for each row execute function public.pm_fill_published_at();

update public.performance_metrics pm set published_at = cp.published_at
from public.content_pieces cp
where pm.content_piece_id = cp.id and pm.published_at is null and cp.published_at is not null;
