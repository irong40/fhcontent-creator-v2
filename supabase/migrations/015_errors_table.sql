-- Migration 015: in-app error log
-- Filed 2026-05-24. Errors previously went only to email (Resend) and the
-- n8n webhook — both push-only channels with no history, no ack flow, no
-- way to triage from inside the dashboard. This adds DB persistence so:
--   1. notifyError writes to errors alongside email/webhook
--   2. The dashboard nav bell shows unread count + recent list
--   3. /admin/errors gives full history + acknowledge flow
--
-- Email/webhook channels remain — DB is additive (belt-and-suspenders).

create table if not exists public.errors (
    id uuid primary key default gen_random_uuid(),
    source text not null,
    message text not null,
    topic_id uuid references public.topics(id) on delete set null,
    persona_name text,
    environment text not null default 'development',
    severity text not null default 'error' check (severity in ('error', 'warning', 'info')),
    acknowledged boolean not null default false,
    acknowledged_at timestamptz,
    acknowledged_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table public.errors is
  'Persistent error log written by notifyError. Surfaced in the dashboard nav bell and at /admin/errors. Email + webhook remain the push channels.';

-- Index for the bell's "unread count" and recent-list queries (both hot paths)
create index if not exists errors_unacked_recent_idx
  on public.errors (acknowledged, created_at desc)
  where acknowledged = false;

-- Index for topic-scoped lookups (e.g., show errors on a topic's review page)
create index if not exists errors_topic_id_idx
  on public.errors (topic_id)
  where topic_id is not null;

alter table public.errors enable row level security;

-- Per CLAUDE.md: single-operator system, authenticated users have full access.
create policy "errors_authenticated_all"
  on public.errors
  for all
  to authenticated
  using (true)
  with check (true);
