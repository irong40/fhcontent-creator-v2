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

## Windows Service (WinSW)
n8n runs as a Windows service via WinSW so it auto-starts on boot.

| File | Location | Purpose |
|------|----------|---------|
| `n8n-service.exe` | D:/n8n/ | WinSW v2.12.0 binary (Windows x64) |
| `n8n-service.xml` | D:/n8n/ | Service definition — runs `docker compose up` on boot |
| `winsw-install.ps1` | D:/n8n/ | One-time setup script (run as Administrator) |

**Service name:** `n8n-docker`
**Startup type:** Automatic (Delayed)
**Key design:** `docker compose up` (foreground, no -d flag) — keeps WinSW process alive so service status stays "Running"

**To reinstall service on new machine:**
```powershell
# Run as Administrator
powershell -ExecutionPolicy Bypass -File "D:\n8n\winsw-install.ps1"
```

**Windows power plan:** High Performance (SCHEME_MIN) — sleep and hibernate disabled to prevent workflow interruption

## Workflow Inventory
| File | Workflow | Phase |
|------|----------|-------|
| (populated as workflows are created) | | |
