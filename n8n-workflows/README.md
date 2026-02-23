# n8n Workflow Version Control

Workflow JSON files are exported from n8n UI and committed here. They contain node configurations and credential references (names/IDs only — no secret values). Safe to commit.

## Export Instructions
1. Open workflow in n8n UI
2. Top-right menu (...) -> Export -> JSON
3. Save to this directory as `{workflow-name}.json`
4. Commit to git

## Credentials Required (names only — values in n8n Credential Store)
When importing workflows to a new n8n instance, recreate these credentials by name:

| Credential Name | Type | Service |
|----------------|------|---------|
| Supabase Service Role | Supabase API | Project `qjpujskwqaehxnqypxzu` |
| Supabase Anon Key | HTTP Header Auth | Project `qjpujskwqaehxnqypxzu` |
| Claude API | HTTP Header Auth | Anthropic |
| HeyGen API | HTTP Header Auth | HeyGen |
| Blotato API | HTTP Header Auth | Blotato |
| ElevenLabs API | HTTP Header Auth | ElevenLabs |
| Gemini API | HTTP Header Auth | Google |
| OpenAI API | HTTP Header Auth | OpenAI |
| Canva API | HTTP Header Auth | Canva |

## Environment Variables Required on New Instance
See D:/n8n/.env for all required n8n system config values.
CRITICAL: N8N_ENCRYPTION_KEY must match the original value — stored in password manager.

## Workflow Inventory
| File | Workflow | Phase |
|------|----------|-------|
| (populated as workflows are created) | | |
