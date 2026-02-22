-- Migration 005: Add podcast outro CTA to brands table

ALTER TABLE brands
    ADD COLUMN podcast_outro_cta TEXT;

-- Seed default for existing brand
UPDATE brands
SET podcast_outro_cta = 'If you enjoyed this episode, subscribe and leave a review. Follow us on social media for daily history content.'
WHERE name = 'History Unveiled VA';
