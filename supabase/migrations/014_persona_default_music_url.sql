-- Migration 014: per-persona default music fallback URL
-- Filed 2026-05-24. Lyria (gemini.generateMusic) is documented in code as
-- "experimental and often fails". When it does, daily-media currently logs
-- a console.warn and leaves piece.music_track as the mood string forever,
-- silently shipping videos without their brand music bed.
--
-- This migration adds a per-persona pre-uploaded fallback URL. When Lyria
-- fails after retries, daily-media uses this URL as the music track instead
-- of skipping. Personas without a fallback URL still skip silently
-- (preserves current behavior).

alter table public.personas
  add column if not exists default_music_url text;

comment on column public.personas.default_music_url is
  'Pre-uploaded fallback music track URL. Used by daily-media when Lyria music generation fails. Null = skip music gracefully on failure (legacy behavior).';
