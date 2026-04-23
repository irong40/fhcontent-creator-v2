-- 010: Lecture video support
-- Extends the pipeline for long-form educational lecture videos (20-30 min)
-- with mixed avatar + faceless scenes

-- ============================================
-- ALTER: content_pieces
-- Add 'lecture' to content_channel enum
-- ============================================
ALTER TABLE content_pieces
    DROP CONSTRAINT IF EXISTS content_pieces_content_channel_check;

ALTER TABLE content_pieces
    ADD CONSTRAINT content_pieces_content_channel_check
    CHECK (content_channel IN ('social', 'podcast', 'newsletter', 'lecture'));

-- ============================================
-- ALTER: topics
-- Add content_channel + lecture_data for lecture-specific metadata
-- ============================================
ALTER TABLE topics
    ADD COLUMN IF NOT EXISTS content_channel TEXT DEFAULT 'social'
        CHECK (content_channel IN ('social', 'podcast', 'newsletter', 'lecture')),
    ADD COLUMN IF NOT EXISTS lecture_data JSONB;

-- ============================================
-- TABLE: lecture_chapters
-- Source material for lecture generation (extracted from PPTs)
-- ============================================
CREATE TABLE lecture_chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id),
    persona_id UUID REFERENCES personas(id),
    chapter_number INT NOT NULL,
    title TEXT NOT NULL,
    week_number INT NOT NULL,
    slide_content JSONB NOT NULL,  -- Array of {slide_number, texts[]}
    key_concepts TEXT[],
    learning_objectives TEXT[],
    field_connections TEXT[],      -- Real-world applications to highlight
    estimated_duration_min INT DEFAULT 25,
    topic_id UUID REFERENCES topics(id),  -- Links to generated topic
    status TEXT DEFAULT 'pending'
        CHECK (status IN ('pending', 'scripted', 'producing', 'ready', 'published')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE lecture_chapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access to lecture_chapters"
    ON lecture_chapters FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_lecture_chapters_brand ON lecture_chapters(brand_id);
CREATE INDEX idx_lecture_chapters_week ON lecture_chapters(week_number);
CREATE INDEX idx_lecture_chapters_status ON lecture_chapters(status);

-- ============================================
-- ALTER: brands
-- Add lecture-specific configuration
-- ============================================
ALTER TABLE brands
    ADD COLUMN IF NOT EXISTS content_mode TEXT DEFAULT 'social'
        CHECK (content_mode IN ('social', 'lecture', 'both')),
    ADD COLUMN IF NOT EXISTS lecture_dimension JSONB DEFAULT '{"width": 1920, "height": 1080}',
    ADD COLUMN IF NOT EXISTS lecture_scene_defaults JSONB DEFAULT '{
        "avatar_background": "#0d1117",
        "faceless_background": "#1a1a2e",
        "text_color": "#ffffff",
        "accent_color": "#58a6ff"
    }';

-- ============================================
-- SEED: CMIT 291 brand
-- ============================================
INSERT INTO brands (
    name, vertical, platform_accounts, cta_template, music_style,
    content_mode, is_active,
    intro_text_template, outro_text_template,
    intro_style, outro_style, brand_color,
    lecture_dimension, lecture_scene_defaults
) VALUES (
    'CMIT 291 Introduction to Linux',
    'IT Education / CompTIA Linux+',
    '{"youtube": true}'::jsonb,
    'Subscribe for more Linux tutorials and real-world sysadmin tips.',
    'ambient, electronic, lo-fi, study beats',
    'lecture',
    true,
    'Welcome to CMIT 291. Today we are covering {topic_title}.',
    'That wraps up our lesson on {topic_title}. Practice these commands in your lab environment and I will see you next time.',
    'avatar',
    'avatar',
    '#0d1117',
    '{"width": 1920, "height": 1080}'::jsonb,
    '{
        "avatar_background": "#0d1117",
        "faceless_background": "#1e293b",
        "text_color": "#e2e8f0",
        "accent_color": "#38bdf8",
        "code_background": "#0f172a",
        "code_text_color": "#22d3ee"
    }'::jsonb
);
