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
