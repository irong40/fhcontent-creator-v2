-- History Unveiled VA rebuild (Adam 2026-10-25 #1, H1): a sourced_quote format where each
-- piece is one point's source passage plus the Dictionary of Virginia Biography.
-- Not applied by this branch. Undo: restore the 016 check (standard, quote_video).
alter table public.personas drop constraint if exists personas_content_format_check;
alter table public.personas
  add constraint personas_content_format_check
  check (content_format in ('standard', 'quote_video', 'sourced_quote'));
