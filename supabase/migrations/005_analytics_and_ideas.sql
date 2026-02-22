-- Migration 005: Performance analytics, content ideas, and evergreen support
-- Sprint 3: Analytics pull from Blotato, idea backlog, evergreen fallback

-- ============================================
-- TABLE: performance_metrics
-- Platform analytics per content piece
-- ============================================
CREATE TABLE performance_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_piece_id UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    views INT DEFAULT 0,
    likes INT DEFAULT 0,
    shares INT DEFAULT 0,
    saves INT DEFAULT 0,
    comments INT DEFAULT 0,
    captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_perf_metrics_piece ON performance_metrics(content_piece_id);
CREATE INDEX idx_perf_metrics_platform ON performance_metrics(platform);
CREATE INDEX idx_perf_metrics_captured ON performance_metrics(captured_at);

ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access to performance_metrics"
    ON performance_metrics FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- TABLE: content_ideas
-- Backlog of content ideas per brand
-- ============================================
CREATE TABLE content_ideas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id),
    title TEXT NOT NULL,
    category TEXT,
    source_notes TEXT,
    is_used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ideas_brand ON content_ideas(brand_id);
CREATE INDEX idx_ideas_used ON content_ideas(is_used);

ALTER TABLE content_ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access to content_ideas"
    ON content_ideas FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- ALTER: topics
-- Add evergreen flag for reuse scheduling
-- ============================================
ALTER TABLE topics ADD COLUMN is_evergreen BOOLEAN DEFAULT false;

-- ============================================
-- ALTER: content_pieces
-- Track which hook formula was used
-- ============================================
ALTER TABLE content_pieces ADD COLUMN hook_performance TEXT;
