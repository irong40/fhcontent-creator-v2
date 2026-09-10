-- 025: Drop the dead social_post_metrics schema.
--
-- public.performance_metrics is, and has always been, the live engagement store
-- (2,554 rows, written daily by /api/cron/analytics-pull and by
-- src/scripts/pull-youtube-metrics.ts).
--
-- public.social_post_metrics + its social_post_metrics_latest view were created
-- alongside it as a parallel design and NEVER received a single row —
-- pg_stat_user_tables reported n_tup_ins = 0 lifetime as of 2026-07-26. They are
-- pure decoys: a metrics query written against the plausible-sounding name
-- returns zero rows and reads as "the pipeline is dead" when it is in fact
-- healthy. That misdiagnosis has already cost one session.
--
-- Nothing in this repo references either object: a grep for the name matches
-- only this file. No migration creates them either, so they were applied
-- out-of-band via dashboard SQL — which is why they never got wired up.
-- Every read/write in src/ targets performance_metrics.
--
-- Guarded with `if exists` so this is a no-op on any environment that never
-- received the out-of-band DDL.

drop view if exists public.social_post_metrics_latest;
drop table if exists public.social_post_metrics;
