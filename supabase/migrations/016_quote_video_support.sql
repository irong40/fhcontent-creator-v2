-- Migration 016: quote-video persona support
-- Filed 2026-06-10. Adds a per-persona content format so a persona can
-- produce a single looping quote-card video per topic instead of the
-- standard 6-piece set (long + 4 shorts + carousel).
--
-- quote_video format mechanics (loop strategy):
--   - One topic = one quote from one historical figure.
--   - daily-media renders ONE 1080x1920 quote card (satori template, $0)
--     and stores it; the local music machine renders a <5s mp4 with a
--     bar-aligned ACE-Step music loop and writes video_url.
--   - The quote takes 10s+ to read, so platforms replay the short clip,
--     counting each loop as a view.
--
-- piece_type 'quote_video' needs no DB change: content_pieces.piece_type
-- is unconstrained TEXT (see 001). This migration only adds the persona
-- format switch.

alter table public.personas
  add column if not exists content_format text not null default 'standard'
    check (content_format in ('standard', 'quote_video'));

comment on column public.personas.content_format is
  'Content production format. standard = 6-piece set (long, short_1-4, carousel). quote_video = single looping quote-card video per topic, music bed rendered locally from ACE-Step tracks.';
