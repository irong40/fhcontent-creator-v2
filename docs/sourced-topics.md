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

Still open from that review: a pass belongs to a topic, not to a version of its text, so a remix after a pass is not rechecked. Media can render for a text that has not passed. The record is `agent-office/content/fh-content/2026-10-05-codex-review.md`.

One consequence to know: `src/scripts/ingest-quiz.ts` inserts quiz shorts as `scheduled`. The gate refuses that insert unless the row is `source_verified` or has a pass. It has refused it since 2026-10-04.
