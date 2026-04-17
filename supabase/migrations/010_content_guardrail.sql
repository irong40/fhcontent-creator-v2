-- Migration 010: Content guardrail and COO publish reporting
-- Adds NotebookLM verification fields to topics and guardrail config to personas

-- Topics: track whether content has been source-verified
ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_verified BOOLEAN DEFAULT false;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT false;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Personas: guardrail configuration
ALTER TABLE personas ADD COLUMN IF NOT EXISTS content_guardrail TEXT DEFAULT 'none';
  -- 'none' = no guardrail (Dr. Imani Carter, F&H)
  -- 'notebooklm' = verify against NotebookLM before auto-approve
ALTER TABLE personas ADD COLUMN IF NOT EXISTS guardrail_notebook_ids TEXT[];
  -- Array of NotebookLM notebook IDs to query for verification
  -- e.g. ARRAY['masonic-history-notebook-1', 'masonic-history-notebook-2']

-- Publish report log for COO daily summaries
CREATE TABLE IF NOT EXISTS publish_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date DATE NOT NULL DEFAULT CURRENT_DATE,
    persona_id UUID REFERENCES personas(id),
    topic_id UUID REFERENCES topics(id),
    topic_title TEXT NOT NULL,
    platforms_published TEXT[] DEFAULT '{}',
    platforms_failed TEXT[] DEFAULT '{}',
    source_verified BOOLEAN DEFAULT false,
    required_review BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for daily report queries
CREATE INDEX IF NOT EXISTS idx_publish_reports_date ON publish_reports(report_date DESC);

-- RLS
ALTER TABLE publish_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON publish_reports FOR ALL USING (true);

COMMENT ON TABLE publish_reports IS 'Daily publish log consumed by COO standup report';
COMMENT ON COLUMN personas.content_guardrail IS 'Guardrail type: none or notebooklm';
COMMENT ON COLUMN personas.guardrail_notebook_ids IS 'NotebookLM notebook IDs for source verification';
-- Facebook page IDs for personas that publish to Facebook pages (JSONB array)
-- e.g. ['1063375450183829', '354636601065407'] for NE Corner + Lodge 79
ALTER TABLE personas ADD COLUMN IF NOT EXISTS facebook_page_ids TEXT[];

COMMENT ON COLUMN topics.source_verified IS 'Whether topic content was verified against guardrail source';
COMMENT ON COLUMN topics.requires_review IS 'Whether topic needs human review before publishing';
COMMENT ON COLUMN personas.facebook_page_ids IS 'Facebook page IDs to publish to (Blotato subaccounts)';
