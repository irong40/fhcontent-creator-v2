-- NEC TikTok post-to-piece link (job 2026-11-22-adam-nec-tiktok-piece-linkage-fix-part2).
-- Adds the link field only: a nullable piece key for posts whose piece is not a
-- content_pieces row (NEC clip ids such as NEC-B20-07 from the loader ledger).
-- Nothing is changed or removed on existing rows.
--
-- Apply only after qcheck clears branch fix/nec-tiktok-piece-link, and before the
-- collector code that writes piece_key is deployed.
--
-- Undo:
--   drop index if exists public.performance_metrics_piece_key_idx;
--   alter table public.performance_metrics drop column if exists piece_key;

alter table public.performance_metrics
    add column if not exists piece_key text;

comment on column public.performance_metrics.piece_key is
    'Piece key from a publishing ledger when the post has no content_pieces row (NEC: ledger clip id). Filled by src/scripts/nec-tiktok-link-backfill.ts and carried by analytics-pull.';

create index if not exists performance_metrics_piece_key_idx
    on public.performance_metrics (piece_key)
    where piece_key is not null;
