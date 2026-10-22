-- HR-7. NOT APPLIED. Applying it to the live project is a separate, authorized release step.
-- Adds the correlation columns to local_inference_jobs, a first-claim time (queue wait vs inference),
-- and the append-only judge_trail table the progress report reads. Leases, the 3-attempt bound and
-- the no-paid-fallback rule are untouched. Rollback: drop table judge_trail; drop the four columns
-- (and restore the claim function from 20261020150000 lineage / 20260911201146).
alter table public.local_inference_jobs
  add column if not exists correlation_id text,
  add column if not exists topic_id text,
  add column if not exists topic_version text,
  add column if not exists first_claimed_at timestamptz;

-- Same body as the 20260911201146 claim function, plus first_claimed_at.
create or replace function public.claim_local_inference_job(p_worker_id text)
returns setof public.local_inference_jobs
language plpgsql security definer set search_path = '' as $$
declare picked uuid;
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 160 then
    raise exception 'invalid worker id';
  end if;
  update public.local_inference_jobs
    set status='failed', last_error='lease_expired', lease_token=null,
        lease_expires_at=null, updated_at=now()
    where status='running' and lease_expires_at <= now() and attempts >= 3;
  select id into picked from public.local_inference_jobs
    where attempts < 3 and (status='queued' or (status='running' and lease_expires_at <= now()))
    order by created_at, id for update skip locked limit 1;
  if picked is null then return; end if;
  return query update public.local_inference_jobs
    set status='running', attempts=attempts+1, worker_id=p_worker_id,
        first_claimed_at=coalesce(first_claimed_at, now()),
        lease_token=gen_random_uuid(), lease_expires_at=now()+interval '300 seconds', updated_at=now()
    where id=picked returning *;
end;
$$;

create table if not exists public.judge_trail (
  id bigint generated always as identity primary key,
  correlation_id text not null,
  stage text not null check (stage in ('enqueued','claimed','inference_done','validated','state_changed','escalated','alert_channel','acknowledged')),
  topic_id text not null,
  topic_version text not null,
  job_id uuid,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists judge_trail_topic_idx on public.judge_trail(topic_id, topic_version, at);
create index if not exists judge_trail_corr_idx on public.judge_trail(correlation_id);
alter table public.judge_trail enable row level security;
revoke all on public.judge_trail from public, anon, authenticated;
grant select, insert on public.judge_trail to service_role;
