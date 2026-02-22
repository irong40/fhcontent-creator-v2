-- Add blotato_template_id to personas for faceless video template routing
ALTER TABLE personas
ADD COLUMN IF NOT EXISTS blotato_template_id text;

COMMENT ON COLUMN personas.blotato_template_id IS 'Blotato video template ID for short-form faceless video generation';
