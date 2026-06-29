-- 017_persona_blotato_video_enabled.sql
-- Per-persona switch for Blotato AI Story Video generation.
--
-- Blotato auto-generates its own b-roll/imagery from the script and gives us
-- no way to enforce or audit the per-persona image_subject_constraint. For
-- Dr. Imani Carter (Black-history content with a mandatory Black-subjects-only
-- constraint) this produced videos with white people in them — a hard brand
-- violation — and the clips are only ~2-3 min, too short to monetize on YouTube.
--
-- Setting this false pauses Blotato long+short video for that persona. Their
-- long-form video is taken over by the local ffmpeg renderer (audited imagery,
-- 8+ min). Carousels (template, no people) and quote videos (local cards) are
-- unaffected.

ALTER TABLE personas
    ADD COLUMN IF NOT EXISTS blotato_video_enabled boolean NOT NULL DEFAULT true;

-- Pause Blotato video for Dr. Imani Carter (History Unveiled VA).
UPDATE personas
SET blotato_video_enabled = false
WHERE name = 'Dr. Imani Carter';
