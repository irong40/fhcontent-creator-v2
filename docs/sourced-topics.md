# Sourced topics

Added 2026-10-05.

## Why

Every topic used to be written by a model from memory in one call. The model filled in each
point's `source` the same way it filled in the claim. An outside check of the 17 History
Unveiled VA texts waiting for review found no point supported by any source. The first
Freedom Voices quotes checked were misworded or credited to the wrong speech.

## What changed

A persona whose `content_guardrail` is `sourced` gets its topics from
`public.topic_candidates` and from nowhere else.

- The office writes candidates from real pages, in a loop a program judges
  (`obsidian-dev/agent-office/cron-agents/lib/fh_topic_loop.py`). Each of the four points
  carries `url` and `quote`: the page, and the passage on it the claim rests on.
- `daily-topic` takes up to 7 ready candidates per sourced persona, oldest first. Fewer
  ready means fewer topics. None ready means none, and an alert. It never calls the model
  for a topic.
- A candidate that becomes a topic is marked `used`. One the duplicate check refuses is
  marked `discarded`.
- `POST /api/topics/generate` answers 409 for a sourced persona. Topics arrive with the
  weekly run only.
- The script prompts show each `SOURCE PASSAGE` and add a rule: every fact in a script,
  caption or title comes from the points. A topic with no passages gets the old prompt,
  unchanged.

Code: `src/lib/sourced-topics.ts`. Tests: `npx vitest run src/lib/sourced-topics.spec.ts`.

## Turning it on for a persona

Set `personas.content_guardrail` to `sourced` (the persona edit page has the field). Until
then nothing changes for that persona.

## What still gates a topic

The database refuses to clear a text's review, approve, schedule or publish a topic until
the office's source validator has filed a pass for it (migration
`20261004232349_topic_source_gate.sql`). The loop's program proves a passage is on a page.
The validator reads the finished text against it.

## The gate, second pass (2026-10-05)

A Codex review of the whole project found ways around the first gate. Adam said yes to closing them the same day.

What changed in the database (`supabase/migrations/20261005220307_topic_source_gate_outbound.sql`):

- `public.topic_source_cleared(topic)` is the rule in one place. A topic is cleared when its newest source check is a pass, or when it has no check and the app's server marked it `source_verified`. A fail always blocks.
- The trigger now also covers `published` and `partially_published`, a date or time given to a topic that is already approved or scheduled, and a review hold cleared on an approved or scheduled topic.
- A topic that is already out may settle among `publishing`, `partially_published` and `published`. It may not go back to `approved` or `scheduled` without a pass.
- A signed-in session cannot set `source_verified`. Only the server can.

What changed in the app:

- `src/lib/source-gate.ts`: `sourceCleared` asks that database function. It fails closed.
- `publishTopic` asks it before anything is sent to a platform. It used to post first and set the status afterwards, so the database's refusal came after the post. The Publish button returns 409 with the reason.
- Quick Post and the lecture route refuse a sourced persona.

Proved with 21 cases run against the live database inside a transaction that was rolled back, and by `publish-source-gate.spec.ts`, `source-gate.spec.ts` and `content/quick-post/route.spec.ts`.

Those two were open when this section was written. Both were closed later the same day: see the next section. The record is `agent-office/content/fh-content/2026-10-05-codex-review.md`.

One consequence to know: `src/scripts/ingest-quiz.ts` inserts quiz shorts as `scheduled`. The gate refuses that insert unless the row is `source_verified` or has a pass. It has refused it since 2026-10-04.

## A pass belongs to one version of the text (2026-10-05, evening)

Adam said yes to the rest of the review's open items.

**The text version.** `supabase/migrations/20261005221723_topic_source_check_text_version.sql` gives each topic's text a fingerprint: its title, hook and points, and each piece's title, script, captions and carousel slide words. Media addresses, image prompts and statuses are left out, so a render does not change it. The office prints the fingerprint for the validator as `Text version:`, and the check row stores it. A pass clears only that version.

`topic_source_state(topic)` answers one of five words:

| State | Meaning | Cleared |
|---|---|---|
| `pass` | the newest check passed this exact text | yes |
| `verified` | no check, and the server marked it `source_verified` | yes |
| `changed` | the text is not the one the newest check read | no |
| `fail` | the newest check failed this text | no |
| `none` | no check | no |

What this means in the app: remix a caption, regenerate a script, edit a slide or change the hook after a pass, and the topic is `changed`. It cannot be approved, scheduled, dated, rendered or published until the validator checks the text as it stands. The edit itself is never refused.

**No render without a pass.** The media cron and the video, voice, thumbnail, music, carousel and podcast routes ask `topic_source_cleared` first and return 409 with the reason. A lecture piece is course material and is not gated there.

**Every writer sees the passages.** `pointLines` and `sourceDiscipline` (`src/lib/sourced-topics.ts`) now feed the quote-video, carousel, podcast, newsletter, remix and regenerate prompts as well as the first draft. For a topic with no source passages each prompt is byte for byte what it was; that was checked against the previous commit.

**A candidate cannot become two topics.** The weekly run claims a candidate (`ready` to `used`) before it creates the topic, links the topic afterwards, and gives the candidate back if no topic came of it. A run that dies in between leaves a spent candidate with no topic, never a second topic. Reading candidates now looks through 200 rows, so bad rows at the front cannot hide good ones.

Proved with 17 cases run against the live database inside a rolled-back transaction, and by `prompts-sourced.spec.ts`, `source-gate.spec.ts`, `daily-media/source-gate.spec.ts` and `sourced-topics.spec.ts`.

Not covered: the podcast script and the newsletter draft are written by a model after the check and are not part of the text version. The podcast feed serves only episodes marked `published`, and nothing in the app marks them. The newsletter draft is a draft. If either is ever sent out as it stands, it has not been source-checked.
