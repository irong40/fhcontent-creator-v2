-- Migration 002: Add content_hash to content_pieces for duplicate detection
-- Sprint 0 dedup support

ALTER TABLE content_pieces ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX idx_content_pieces_hash
    ON content_pieces(content_hash)
    WHERE content_hash IS NOT NULL;
