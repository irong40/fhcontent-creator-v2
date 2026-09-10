-- content_pieces.title — the headline a single piece publishes under.
--
-- Every piece of a topic previously published under the TOPIC title, so a
-- story's six uploads appeared on the channel as six identical rows. Measured
-- 2026-07-30 on They Never Told Us: five consecutive uploads in one day all
-- reading "The Fredericksburg Silk Cooperative: When 200 Black Women Built…".
-- That reads as duplicate spam and gives a viewer no reason to open more than
-- one of them.
--
-- Nullable on purpose. daily-publish resolves the title through a fallback
-- chain (helpers.pieceTitle): this column, then the first sentence of
-- caption_short, then the topic title. The middle rung means the ~550 existing
-- rows get distinct titles immediately without a backfill, and a model response
-- that omits the field degrades rather than failing a topic's generation.
--
-- 100 chars matches YouTube's hard title limit; the platform truncators
-- (truncateYouTubeTitle / truncateTikTokTitle) still apply per-platform caps.

ALTER TABLE public.content_pieces
    ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN public.content_pieces.title IS
'Per-piece publish headline. Null on rows generated before 2026-07-30; '
'daily-publish falls back to the first sentence of caption_short, then the '
'topic title. The long/lecture pieces intentionally keep the topic title.';
