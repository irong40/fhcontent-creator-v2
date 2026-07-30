-- get_format_performance — the format half of the engagement feedback loop.
--
-- get_topic_winners (018) closed the loop on WHICH STORIES to tell, and it works.
-- Nothing closed the loop on FORMAT. Piece mix, slot times, titles, visual
-- treatment and long-form length are all hardcoded constants, and
-- content_pieces.hook_performance was scaffolded but never written to (0 of 552
-- rows populated as of 2026-07-30).
--
-- The gap is structural, not a missing metric: get_topic_winners aggregates at
-- the TOPIC level, summing a story's long-form and four shorts into one number.
-- It therefore cannot see that short_1 outperforms short_4, or that the
-- long-form — the piece meant to draw viewers in — trails every short of its own
-- topic. And because topic engagement is dominated by four shorts against one
-- long, the existing loop optimises for shorts and is blind to the long-form.
--
-- Measured on the same data this function reads (Dr. Imani Carter, all time):
--     short_1  40 posts  avg 25.8 views
--     short_3  24 posts  avg 18.6
--     short_2  25 posts  avg 15.0
--     short_4  28 posts  avg 13.5
--     long     16 posts  avg 12.4
--
-- Read-only and human-in-the-loop by design: this surfaces on /admin/social
-- next to the existing recommendations panel. It does NOT auto-tune slots.
-- Coverage is uneven across piece types and YouTube capture has known gaps, so
-- these numbers inform a decision; they do not make one.

CREATE OR REPLACE FUNCTION public.get_format_performance(
    p_persona_id uuid,
    p_days integer DEFAULT 30
)
RETURNS TABLE(
    piece_type text,
    platform text,
    posts bigint,
    views bigint,
    avg_views numeric,
    eng_per_view numeric,
    avg_publish_hour_et integer
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    -- One row per (piece, platform): the most recent snapshot. Metrics are
    -- cumulative per post, so summing raw snapshots would multiply-count.
    WITH latest AS (
        SELECT DISTINCT ON (pm.content_piece_id, pm.platform)
               pm.content_piece_id, pm.platform,
               pm.views, pm.likes, pm.comments, pm.shares, pm.saves,
               cp.piece_type, cp.published_at, cp.topic_id
        FROM performance_metrics pm
        JOIN content_pieces cp ON cp.id = pm.content_piece_id
        WHERE pm.captured_at >= now() - make_interval(days => p_days)
        ORDER BY pm.content_piece_id, pm.platform, pm.captured_at DESC
    )
    SELECT
        l.piece_type::text,
        l.platform::text,
        COUNT(*)::bigint,
        SUM(l.views)::bigint,
        ROUND(AVG(l.views), 1),
        -- Same weighting as get_topic_winners: shares and saves are worth 4x a
        -- like, comments 2x. Engaged actions per view, not vanity reach.
        ROUND(
            (SUM(l.likes) + 2 * SUM(l.comments) + 4 * SUM(l.shares) + 4 * SUM(l.saves))::numeric
            / NULLIF(SUM(l.views), 0),
            4
        ),
        ROUND(AVG(EXTRACT(HOUR FROM (l.published_at AT TIME ZONE 'America/New_York'))))::integer
    FROM latest l
    JOIN topics t ON t.id = l.topic_id
    WHERE t.persona_id = p_persona_id
    GROUP BY l.piece_type, l.platform
    ORDER BY AVG(l.views) DESC NULLS LAST;
END;
$function$;

COMMENT ON FUNCTION public.get_format_performance(uuid, integer) IS
'Per-format engagement for one persona: groups performance_metrics by piece_type '
'and platform instead of by topic, so the long-form can be compared against the '
'shorts that are meant to feed it. Companion to get_topic_winners, which '
'aggregates at topic level and cannot resolve format.';
