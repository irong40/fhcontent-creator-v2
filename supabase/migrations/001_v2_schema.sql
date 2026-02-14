-- Content Command Center V2 Database Schema
-- Version: 2.0
-- Adds: HeyGen, ElevenLabs, Canva integrations + audio/visual asset tables

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- For text similarity checking

-- ============================================
-- TABLE: personas
-- Brand/creator profiles
-- ============================================
CREATE TABLE personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    tagline TEXT,
    -- AI Generation Settings
    expertise_areas TEXT[] NOT NULL,
    voice_style TEXT NOT NULL,
    content_guidelines TEXT,
    -- Platform Accounts (Blotato account IDs)
    platform_accounts JSONB NOT NULL,
    -- Voice Pool (ElevenLabs voice IDs)
    voice_pool TEXT[] NOT NULL,
    -- Profile
    profile_image_url TEXT,
    -- V2: External service IDs
    heygen_avatar_id TEXT,
    canva_brand_kit_id TEXT,
    canva_carousel_template_id TEXT,
    -- Status
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TABLE: topics
-- Weekly topic containers
-- ============================================
CREATE TABLE topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    hook TEXT NOT NULL,
    historical_points JSONB NOT NULL,
    topic_hash TEXT NOT NULL,
    voice_id TEXT NOT NULL,
    thumbnail_prompt TEXT,
    publish_date DATE,
    publish_time TIME DEFAULT '09:00:00',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT now(),
    topics_approved_at TIMESTAMPTZ,
    content_ready_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INT DEFAULT 0
);

CREATE INDEX idx_topics_hash ON topics(persona_id, topic_hash);
CREATE INDEX idx_topics_status ON topics(status);
CREATE INDEX idx_topics_publish_date ON topics(publish_date);

-- ============================================
-- TABLE: content_pieces
-- Individual content items (6 per topic)
-- ============================================
CREATE TABLE content_pieces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    piece_type TEXT NOT NULL,
    piece_order INT NOT NULL,
    script TEXT,
    caption_long TEXT,
    caption_short TEXT,
    thumbnail_prompt TEXT,
    carousel_slides JSONB,
    music_track TEXT,
    -- Blotato Integration
    blotato_job_id TEXT,
    blotato_status TEXT,
    -- V2: HeyGen Integration
    heygen_job_id TEXT,
    heygen_status TEXT,
    -- V2: Thumbnail / Visual
    thumbnail_url TEXT,
    canva_design_id TEXT,
    -- Media URLs
    video_url TEXT,
    carousel_url TEXT,
    -- Publishing
    published_platforms JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    produced_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    UNIQUE(topic_id, piece_type)
);

CREATE INDEX idx_pieces_topic ON content_pieces(topic_id);
CREATE INDEX idx_pieces_status ON content_pieces(status);
CREATE INDEX idx_pieces_blotato ON content_pieces(blotato_job_id);
CREATE INDEX idx_pieces_heygen ON content_pieces(heygen_job_id);

-- ============================================
-- TABLE: voices
-- ElevenLabs voice rotation tracking
-- ============================================
CREATE TABLE voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT,
    accent TEXT,
    style TEXT,
    last_used_at TIMESTAMPTZ,
    use_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- TABLE: audio_assets (V2 NEW)
-- ElevenLabs TTS audio files
-- ============================================
CREATE TABLE audio_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_piece_id UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
    voice_id TEXT NOT NULL REFERENCES voices(id),
    elevenlabs_request_id TEXT,
    audio_url TEXT,
    duration_seconds DECIMAL(8, 2),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audio_piece ON audio_assets(content_piece_id);
CREATE INDEX idx_audio_status ON audio_assets(status);

-- ============================================
-- TABLE: visual_assets (V2 NEW)
-- Images, thumbnails, carousel designs
-- ============================================
CREATE TABLE visual_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_piece_id UUID NOT NULL REFERENCES content_pieces(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL, -- 'thumbnail', 'carousel_image', 'background'
    source_service TEXT NOT NULL, -- 'openai', 'canva', 'heygen'
    source_id TEXT,
    asset_url TEXT,
    metadata JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_visual_piece ON visual_assets(content_piece_id);
CREATE INDEX idx_visual_status ON visual_assets(status);

-- ============================================
-- TABLE: published_log
-- Historical record for duplicate check
-- ============================================
CREATE TABLE published_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id UUID NOT NULL REFERENCES personas(id),
    topic_id UUID REFERENCES topics(id),
    topic_title TEXT NOT NULL,
    topic_hash TEXT NOT NULL,
    published_at DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_published_persona ON published_log(persona_id);
CREATE INDEX idx_published_hash ON published_log(topic_hash);

-- ============================================
-- TABLE: cost_tracking
-- API usage and cost monitoring
-- ============================================
CREATE TABLE cost_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service TEXT NOT NULL,
    operation TEXT NOT NULL,
    topic_id UUID REFERENCES topics(id),
    content_piece_id UUID REFERENCES content_pieces(id),
    cost_usd DECIMAL(10, 4) NOT NULL,
    tokens_input INT,
    tokens_output INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_cost_date ON cost_tracking(created_at);
CREATE INDEX idx_cost_service ON cost_tracking(service);

-- ============================================
-- VIEW: cost_summary
-- ============================================
CREATE VIEW cost_summary AS
SELECT date_trunc('day', created_at) AS date,
    service,
    COUNT(*) AS operations,
    SUM(cost_usd) AS total_cost
FROM cost_tracking
GROUP BY date_trunc('day', created_at), service
ORDER BY date DESC;

-- ============================================
-- FUNCTION: get_lru_voice
-- Get least recently used voice from pool
-- ============================================
CREATE OR REPLACE FUNCTION get_lru_voice(p_persona_id UUID) RETURNS TEXT AS $$
DECLARE v_voice_id TEXT;
v_voice_pool TEXT[];
BEGIN
SELECT voice_pool INTO v_voice_pool
FROM personas
WHERE id = p_persona_id;

SELECT id INTO v_voice_id
FROM voices
WHERE id = ANY(v_voice_pool)
    AND is_active = true
ORDER BY last_used_at NULLS FIRST,
    use_count ASC
LIMIT 1;

UPDATE voices
SET last_used_at = now(),
    use_count = use_count + 1
WHERE id = v_voice_id;

RETURN v_voice_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: check_duplicate_topic
-- Check for duplicate topics using similarity
-- ============================================
CREATE OR REPLACE FUNCTION check_duplicate_topic(
    p_persona_id UUID,
    p_title TEXT,
    p_threshold FLOAT DEFAULT 0.8
) RETURNS TABLE(
    is_duplicate BOOLEAN,
    similar_title TEXT,
    similarity FLOAT
) AS $$ BEGIN RETURN QUERY
SELECT similarity(lower(p_title), lower(topic_title)) > p_threshold AS is_duplicate,
    topic_title AS similar_title,
    similarity(lower(p_title), lower(topic_title)) AS similarity
FROM published_log
WHERE persona_id = p_persona_id
ORDER BY similarity DESC
LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE published_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_tracking ENABLE ROW LEVEL SECURITY;

-- Authenticated users can do everything (single-operator system)
CREATE POLICY "Authenticated users have full access to personas"
    ON personas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to topics"
    ON topics FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to content_pieces"
    ON content_pieces FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to voices"
    ON voices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to audio_assets"
    ON audio_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to visual_assets"
    ON visual_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to published_log"
    ON published_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users have full access to cost_tracking"
    ON cost_tracking FOR ALL TO authenticated USING (true) WITH CHECK (true);
