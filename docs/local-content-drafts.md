# Supervised local content drafts

This local command replaces a hosted text request for a supplied-source caption, remix or newsletter draft. It does not run Vercel cron, update content rows, generate media, or publish. Existing cloud routes retain their providers until a durable host-worker integration is separately validated.

Run from this repository with Ollama available locally:

```powershell
npx tsx scripts/local-content-draft.ts scripts/local-content-source.example.json local-draft.json
```

The source packet contains `kind` (captions/remix/newsletter), a stable `sourceId`, `reviewedBy`, `source` and optional `instructions`. Replace the synthetic example with an independently reviewed source. The command fails when required evidence metadata is missing. A typed reviewer name is provenance, not authentication or proof of review. Source text is limited to 10,000 characters to keep requests bounded. The output filename must not exist; existing files and source packets are never overwritten.

The pinned local baseline is qwen3:8b at loopback port 11434. The command has a 90-second request timeout, no retry and no hosted fallback. Output uses JSON Schema plus Zod validation, requires a completed response, exact source reference, task word limit and numeric tokens present in the source. These checks do not prove correct meaning, names, preserved context or completeness. Every result is marked `needs_review`; it cannot authorize publication. This numeric guard may reject valid paraphrases with altered number formatting; edit the source representation or review the rejected case rather than bypassing the hold.

Output includes provider/model, source hash, source reviewer, prompt version, token counts and elapsed time. It deliberately reports no dollar saving: local operating costs and avoided hosted charges were not measured.

Verification: `npx vitest run src/lib/local-content-draft.spec.ts`. Tests cover missing evidence, local endpoint/schema, review status/provenance, empty/malformed/truncated/unfinished output, wrong model/source, introduced numbers, and no fallback. Live smoke results are recorded in the business migration report after execution.

Live verification on September 11: the actual CLI produced `docs/local-content-smoke-2026-09-11.json` using Ollama. The source was explicitly synthetic. The caption preserved aerial-documentation scope and the safety/engineering limitation; it remains a draft. Request time was 15.4 seconds including loading, with 217 input and 83 output tokens reported by Ollama. No hosted API was invoked.

The repository-wide test suite passed 467 tests before adding the final word-limit regression. Repository-wide TypeScript checking failed on three pre-existing `/s` regular expressions in `src/lib/prompts.spec.ts:237-239` with the configured pre-ES2018 target; those expressions were confirmed in HEAD. The new module, command and tests pass a scoped type check using the same ES2017 target. No unrelated target change was made.
