# HUVA Photography Rule — Pipeline Flag

**Filed:** 2026-05-07
**Filed by:** Adam (via COO session)
**Severity:** High — content already shipped may violate rule
**Status:** Spec only. Code change pending engineer implementation.

---

## The rule

**Every photograph featuring people in History Unveiled VA / Dr. Imani Carter content must show Black subjects only.** No white people in any frame — including background, crowd shots, or incidental presence.

Sole exception: a video where white presence IS the corrective story being told (e.g., a lynch mob photo for a racial-terror video). In those cases the framing must be explicitly corrective in the surrounding script.

Rule lives in:
- `obsidian-dev/projects/content-creator/personas/history-unveiled-va-brand-kit.md` — section "People in photography — STRICT RULE"
- `~/.claude/projects/C--WINDOWS-system32/memory/feedback_huva-photography-rule.md`

---

## Why this matters

History Unveiled VA exists to restore Black Virginian memory. White subjects in the frame, even incidentally, recenter the wrong narrative and break audience trust. The brand promise fails the moment a viewer sees a white face on what is supposed to be a piece of Black history media.

This is not a tone preference. It is a hard editorial rule.

---

## Code change required

### 1. Image prompt generation — inject persona-scoped rule

**File:** `src/lib/prompts.ts`

Two prompt builders generate image prompts that are brand-agnostic and need to become persona-conditional:

**Site A — `buildCarouselSlidesPrompt`, around line 215:**
```ts
- image_prompt: a vivid, detailed prompt for AI image generation that matches the slide content. Style: historical, photorealistic, cinematic lighting, no text overlay.
```

**Site B — `buildContentPiecesPrompt`, around line 165:**
```ts
- thumbnailPrompt: Prompt for AI thumbnail generation
```

**Required change.** Both builders need to accept the full `persona` row (not just `brandTone`) and inject this addition when `persona.brand === 'History Unveiled VA'` (or persona ID matches `6ac9adfa-27f1-492b-98e1-f5623cb4eda2`):

```
SUBJECT CONSTRAINT (mandatory): All people depicted in this image MUST be Black / African American. No white, Asian, Hispanic, or other non-Black subjects may appear, including in background, crowd, or incidental positions. If the historical scene cannot be rendered without non-Black subjects, return image_prompt as a documents/landscape/architecture composition with NO people instead.
```

Place this constraint at the END of the image_prompt instruction so it's the last thing the LLM weights when writing the prompt itself.

**Generalize for future personas.** Add a `personas.image_subject_constraint` text column (or JSON field on `personas.config`) so other personas can register their own subject rules without code changes. HUVA's value populates with the constraint above.

### 2. Pre-publish vision-model gate

**File:** `src/app/api/cron/daily-media/route.ts`

After image generation but before the asset is attached to a `content_pieces` row and queued for publish, run a one-shot vision audit:

```ts
// Pseudo-code
const audit = await visionModel.check({
  image: generatedImageUrl,
  prompt: "Does this image contain any white, Asian, Hispanic, or non-Black/African subjects? Answer yes or no only.",
});

if (audit.answer === 'yes') {
  // Hold the piece for manual review
  await supabase.from('content_pieces').update({
    status: 'pending_review',
    review_reason: 'huva_subject_audit_failed',
  }).eq('id', piece.id);
  continue;
}
```

Cheapest implementation: Claude Haiku 4.5 vision call (~$0.001 per image at current pricing). Alternative: Gemini 2.0 Flash. Either is fast enough for the daily-media cron.

Apply the gate ONLY for HUVA persona (gate by `persona.image_subject_constraint IS NOT NULL` once the column exists).

### 3. Temporary safety hold (immediate)

Until the gate is live, set HUVA topics in next Sunday's batch to `pending_review` instead of auto-shipping:

```sql
-- Run before next Sunday 02:00 UTC
update topics
set coo_auto_approved_at = null
where persona_id = '6ac9adfa-27f1-492b-98e1-f5623cb4eda2'
  and status = 'scheduled'
  and publish_date >= current_date;
```

This forces Adam to manually approve each HUVA topic during the weekly preview email until the prompt change + vision gate ships.

---

## Audit query for already-shipped HUVA content

Run in Supabase SQL editor. Surfaces every HUVA piece that has a generated image, with the image URL and prompt for manual review. Adam reviews each, flags violations, marks for takedown.

```sql
-- HUVA shipped-content photo audit
-- Adam: review each row. If any non-Black subject appears, flag the piece.

select
  cp.id                          as piece_id,
  t.title                        as topic_title,
  cp.piece_type,
  cp.platform,
  cp.published_at,
  cp.thumbnail_url,
  cp.thumbnail_prompt,
  cp.media_urls,                 -- full array of image URLs (carousel slides)
  cp.carousel_slides,            -- jsonb with imagePrompt per slide
  cp.status
from content_pieces cp
join topics t on t.id = cp.topic_id
where t.persona_id = '6ac9adfa-27f1-492b-98e1-f5623cb4eda2'  -- Dr. Carter / HUVA
  and cp.status in ('published', 'scheduled', 'content_ready')
  and (cp.thumbnail_url is not null or cp.media_urls is not null)
order by cp.published_at desc nulls last, cp.created_at desc;
```

**Expected workflow:**
1. Run query, export results to CSV.
2. Open each `thumbnail_url` and every URL in `media_urls`.
3. Scan every face. One non-Black subject = flag.
4. For flagged pieces:
   - If still in `scheduled`/`content_ready`: regenerate image, do not publish until clean.
   - If already `published`: take down on each platform, regenerate, repost. Update Supabase row with new URL.
5. Log flagged piece IDs in `findings.md` with disposition.

---

## Acceptance criteria

This flag is resolved when ALL of:

- [ ] `personas.image_subject_constraint` column exists in Supabase (or equivalent persona-config field).
- [ ] HUVA persona row has the constraint populated.
- [ ] `buildCarouselSlidesPrompt` and `buildContentPiecesPrompt` (and any other image-prompt site) inject the constraint when present.
- [ ] `daily-media` cron has a vision-model audit gate that holds non-compliant images for review.
- [ ] Audit query has been run by Adam.
- [ ] Every flagged shipped piece has been regenerated, replaced, or taken down.
- [ ] Temporary safety hold removed (HUVA back on auto-approve).

---

## Open questions for engineer

1. Is the persona-config JSON field the right home for the rule, or do we want a dedicated column? (Vote: dedicated column for queryability.)
2. Which vision model — Claude Haiku 4.5 or Gemini 2.0 Flash? Either works; pick whichever is already wired into the project.
3. For carousels with 8–10 images, do we audit every slide or sample? (Recommendation: every slide. Cost is negligible at Haiku pricing.)
4. Should the rule extend to video frames (HeyGen avatar B-roll), or images only for v1? (Recommendation: images only for v1; video adds in a follow-up.)

---

## Related

- HUVA brand kit: `obsidian-dev/projects/content-creator/personas/history-unveiled-va-brand-kit.md`
- Memory rule: `~/.claude/projects/C--WINDOWS-system32/memory/feedback_huva-photography-rule.md`
- Pipeline architecture: `~/.claude/projects/C--WINDOWS-system32/memory/content-creator-weekly-batch.md`
- Agent log entry: `~/.claude/projects/C--WINDOWS-system32/memory/agent-log.md` (2026-05-07 entry)
