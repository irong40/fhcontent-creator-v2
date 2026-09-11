-- Local Ollama transport only. Does not authorize publication or approve generated content.
-- New service-role-only table; states are CHECK values, not an existing business enum.
-- Worker: claim_local_inference_job(worker id), finish_local_inference_job(id, token,
-- text, input tokens, output tokens, nullable safe error code). 300s lease, 3 attempts.
create table public.local_inference_jobs (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique check (length(request_key) = 64),
  system_prompt text not null check (length(system_prompt) between 1 and 24000),
  user_prompt text not null check (length(user_prompt) between 1 and 64000),
  max_tokens integer not null check (max_tokens between 1 and 8192),
  response_schema jsonb check (response_schema is null or jsonb_typeof(response_schema) = 'object'),
  model text not null default 'qwen3:8b' check (model = 'qwen3:8b'),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_id text,
  result_text text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(system_prompt) + octet_length(user_prompt) <= 24000),
  check (octet_length(system_prompt) + octet_length(user_prompt) + max_tokens + 512 <= 16384)
);
alter table public.local_inference_jobs enable row level security;
revoke all on public.local_inference_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.local_inference_jobs to service_role;
create index local_inference_jobs_claim_idx on public.local_inference_jobs(status, created_at)
  where status in ('queued','running');

create function public.claim_local_inference_job(p_worker_id text)
returns setof public.local_inference_jobs
language plpgsql security definer set search_path = '' as $$
declare picked uuid;
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 160 then
    raise exception 'invalid worker id';
  end if;
  -- Expired final attempts must not remain running forever.
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
        lease_token=gen_random_uuid(), lease_expires_at=now()+interval '300 seconds', updated_at=now()
    where id=picked returning *;
end;
$$;

create function public.finish_local_inference_job(
  p_job_id uuid, p_lease_token uuid, p_text text,
  p_input_tokens integer, p_output_tokens integer, p_error text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  if p_error is null and (p_text is null or length(btrim(p_text))=0 or length(p_text)>100000
      or p_input_tokens is null or p_input_tokens < 0 or p_output_tokens is null or p_output_tokens < 0) then
    raise exception 'invalid completion';
  end if;
  if p_error is not null and length(p_error) not between 1 and 240 then
    raise exception 'invalid safe error code';
  end if;
  update public.local_inference_jobs
    set status=case when p_error is null then 'succeeded' when attempts >= 3 then 'failed' else 'queued' end,
        result_text=case when p_error is null then p_text else null end,
        input_tokens=case when p_error is null then p_input_tokens else null end,
        output_tokens=case when p_error is null then p_output_tokens else null end,
        last_error=p_error, lease_token=null, lease_expires_at=null, updated_at=now()
    where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now();
  get diagnostics affected = row_count;
  return affected=1;
end;
$$;
revoke all on function public.claim_local_inference_job(text) from public, anon, authenticated;
revoke all on function public.finish_local_inference_job(uuid,uuid,text,integer,integer,text) from public, anon, authenticated;
grant execute on function public.claim_local_inference_job(text) to service_role;
grant execute on function public.finish_local_inference_job(uuid,uuid,text,integer,integer,text) to service_role;
