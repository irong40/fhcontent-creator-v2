-- Track when COO (the daily-topic cron) auto-approved a topic for publishing.
-- Distinct from manual /approve so the morning digest can show what
-- shipped autonomously vs. what Adam touched.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS coo_auto_approved_at timestamptz;
CREATE INDEX IF NOT EXISTS topics_coo_auto_approved_at_idx ON topics (coo_auto_approved_at)
    WHERE coo_auto_approved_at IS NOT NULL;
