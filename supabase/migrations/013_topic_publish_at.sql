-- 013_topic_publish_at.sql
-- Add intra-day publish staggering. Previously publish_date (DATE) caused
-- every topic with the same date to ship in one hourly cron tick.
--
-- publish_at is the canonical "when to ship". publish_date is kept for
-- backwards compat with the calendar UI / weekly preview email.
--
-- Convention: daily-topic sets publish_at = publish_date 13:00 UTC (≈ 9 AM
-- ET, mid-morning ET / lunchtime US). One topic per day per persona, so no
-- intra-day collision risk for now.

ALTER TABLE topics
    ADD COLUMN IF NOT EXISTS publish_at timestamptz;

-- Backfill: existing scheduled rows get publish_date + 13:00 UTC.
-- partially_published rows keep their existing published_at; we don't
-- backfill those because the retry path uses status not publish_at.
UPDATE topics
SET publish_at = (publish_date::timestamp + interval '13 hours') AT TIME ZONE 'UTC'
WHERE publish_at IS NULL
  AND publish_date IS NOT NULL
  AND status IN ('scheduled', 'approved');

CREATE INDEX IF NOT EXISTS idx_topics_publish_at
    ON topics (publish_at)
    WHERE status IN ('scheduled', 'approved', 'partially_published');
