-- Migration 003: Brands table, podcast_episodes, and schema updates
-- Sprint 1: Multi-brand support, podcast pipeline, newsletter CTA

-- ============================================
-- TABLE: brands
-- Multi-brand/vertical support
-- ============================================
CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    vertical TEXT,
    platform_accounts JSONB DEFAULT '{}',
    cta_template TEXT,
    music_style TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access to brands"
    ON brands FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- ALTER: personas
-- Add brand link + HeyGen voice + newsletter fields
-- ============================================
ALTER TABLE personas
    ADD COLUMN brand_id UUID REFERENCES brands(id),
    ADD COLUMN heygen_voice_id TEXT,
    ADD COLUMN newsletter_url TEXT,
    ADD COLUMN newsletter_cta TEXT;

-- ============================================
-- ALTER: content_pieces
-- Add content_channel for multi-channel routing
-- ============================================
ALTER TABLE content_pieces
    ADD COLUMN content_channel TEXT DEFAULT 'social'
    CHECK (content_channel IN ('social', 'podcast', 'newsletter'));

-- ============================================
-- TABLE: podcast_episodes
-- Podcast pipeline with RSS support
-- ============================================
CREATE TABLE podcast_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
    brand_id UUID REFERENCES brands(id),
    persona_id UUID REFERENCES personas(id),
    title TEXT NOT NULL,
    script TEXT,
    audio_url TEXT,
    duration_seconds INTEGER,
    rss_guid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    published_at TIMESTAMPTZ,
    status TEXT DEFAULT 'draft'
        CHECK (status IN ('draft', 'generating', 'ready', 'published', 'error')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE podcast_episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access to podcast_episodes"
    ON podcast_episodes FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- SEED: History Unveiled VA brand
-- ============================================
INSERT INTO brands (name, vertical, platform_accounts, cta_template, music_style, is_active)
VALUES (
    'History Unveiled VA',
    'African American History',
    '{"youtube": true, "tiktok": true, "instagram": true, "facebook": true, "threads": true, "fanbase": true}'::jsonb,
    'Subscribe to our newsletter for more untold stories from Virginia history: {newsletter_url}',
    'gospel, organ, bass, slow 12/8, warm, reverent',
    true
);
