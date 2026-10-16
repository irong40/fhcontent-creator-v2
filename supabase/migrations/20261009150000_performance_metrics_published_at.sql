-- Publish date per post. Applied live via MCP 2026-10-09; this file version-controls it.
-- Undo: alter table public.performance_metrics drop column published_at;
alter table public.performance_metrics add column if not exists published_at timestamptz;
update public.performance_metrics pm set published_at = cp.published_at
from public.content_pieces cp
where pm.content_piece_id = cp.id and pm.published_at is null and cp.published_at is not null;
