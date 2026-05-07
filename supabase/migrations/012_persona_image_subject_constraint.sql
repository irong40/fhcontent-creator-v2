-- Migration 012: persona-scoped image subject constraint
-- Filed 2026-05-07. Allows each persona to register a hard rule about who may
-- appear in generated imagery. Injected into image-prompt builders (thumbnails,
-- carousel slides) when set; null = no constraint.
--
-- Initial use case: History Unveiled VA / Dr. Imani Carter content must depict
-- Black subjects only. AI-generated images previously included white subjects
-- in background and crowd shots, breaking the brand's editorial promise.

alter table public.personas
  add column if not exists image_subject_constraint text;

comment on column public.personas.image_subject_constraint is
  'Hard editorial rule injected into AI image-generation prompts (thumbnails, carousel slides). Example: "All people depicted MUST be Black/African American — no other ethnicities in any frame, including background." Null = no constraint.';

-- Populate for Dr. Imani Carter / History Unveiled VA persona.
update public.personas
set image_subject_constraint =
  'SUBJECT CONSTRAINT (mandatory): All people depicted in this image MUST be Black or African American. No white, Asian, Hispanic, or other non-Black subjects may appear, including in background, crowd, or incidental positions. If the historical scene cannot be rendered without non-Black subjects, return an image_prompt that depicts documents, landscape, architecture, or objects with NO people instead.'
where id = '6ac9adfa-27f1-492b-98e1-f5623cb4eda2';
