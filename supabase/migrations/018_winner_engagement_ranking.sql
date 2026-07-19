-- Re-rank get_topic_winners by ENGAGEMENT (leading indicators) instead of raw
-- views. The feedback loop was steering new topics toward whatever got the most
-- impressions — a vanity metric that rewards reach without resonance. The stated
-- goal is engagement rate + shares/saves, which actually drive growth.
--
-- New ranking: weighted engaged actions per view (shares & saves weighted
-- highest as the strongest intent signals), with a small view floor so a
-- 3-view fluke can't win. Falls back to absolute engagement then views so the
-- loop still returns sensible winners while engagement data is still thin.
--
-- Return columns are unchanged (title, views, likes) so the daily-topic caller
-- needs no change.

CREATE OR REPLACE FUNCTION public.get_topic_winners(p_persona_id uuid, p_days integer DEFAULT 10, p_limit integer DEFAULT 8)
 RETURNS TABLE(title text, views bigint, likes bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
    RETURN QUERY
    WITH latest AS (
        SELECT DISTINCT ON (pm.content_piece_id, pm.platform)
               pm.views, pm.likes, pm.comments, pm.shares, pm.saves, cp.topic_id
        FROM performance_metrics pm
        JOIN content_pieces cp ON cp.id = pm.content_piece_id
        WHERE pm.captured_at >= now() - make_interval(days => p_days)
        ORDER BY pm.content_piece_id, pm.platform, pm.captured_at DESC
    ),
    agg AS (
        SELECT t.id,
               t.title,
               SUM(l.views)::bigint    AS v,
               SUM(l.likes)::bigint     AS lk,
               -- weighted engaged actions: saves & shares count most (strongest
               -- growth intent), then comments, then likes.
               (SUM(l.likes) + 2 * SUM(l.comments) + 4 * SUM(l.shares) + 4 * SUM(l.saves))::numeric AS eng
        FROM latest l
        JOIN topics t ON t.id = l.topic_id
        WHERE t.persona_id = p_persona_id
        GROUP BY t.id, t.title
    )
    SELECT agg.title, agg.v, agg.lk
    FROM agg
    WHERE agg.v >= 25                       -- reach floor: ignore tiny-sample noise
    ORDER BY (agg.eng / NULLIF(agg.v, 0)) DESC NULLS LAST,  -- engagement RATE first
             agg.eng DESC,                                   -- then absolute engagement
             agg.v DESC                                      -- then reach as tiebreak
    LIMIT p_limit;
END;
$function$;
