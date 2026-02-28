-- 009: HeyGen multi-scene video support (intro + outro scenes)
-- Adds configurable intro/outro templates and brand visuals to brands table

ALTER TABLE brands
    ADD COLUMN intro_text_template TEXT,
    ADD COLUMN outro_text_template TEXT,
    ADD COLUMN background_image_url TEXT,
    ADD COLUMN intro_style TEXT DEFAULT 'avatar' CHECK (intro_style IN ('avatar', 'background_only')),
    ADD COLUMN outro_style TEXT DEFAULT 'avatar' CHECK (outro_style IN ('avatar', 'background_only')),
    ADD COLUMN brand_color TEXT;

-- Seed History Unveiled VA with example templates
UPDATE brands
SET
    intro_text_template = 'Welcome to {brand_name}. Today: {topic_title}.',
    outro_text_template = 'Thanks for watching {brand_name}. {cta}',
    intro_style = 'avatar',
    outro_style = 'background_only',
    brand_color = '#1a1a2e'
WHERE name = 'History Unveiled VA';
