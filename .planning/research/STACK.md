# Stack Research: n8n Orchestration

> Research date: 2026-02-22
> Context: Replacing Vercel Cron jobs with self-hosted n8n on Windows for FHContent Creator v2.

---

## Recommended Stack

| Component | Recommendation | Version | Rationale |
|-----------|---------------|---------|-----------|
| n8n | Self-hosted via Docker Desktop + Docker Compose | **2.9.0** (latest as of 2026-02-16) | Current stable. 2.x line is the active branch; 1.x reached EOL 3 months post-2.0 launch |
| Runtime | Docker Desktop on Windows with WSL2 backend | Latest Docker Desktop | WSL2 mode eliminates Windows file-path and permission issues; standard in all 2025/26 guides |
| Database | PostgreSQL 15+ (Docker Compose service) | 15.x | SQLite is fine for local dev but PostgreSQL is the production standard; required if you ever scale to multi-main |
| Webhook exposure | `WEBHOOK_URL` env var + Cloudflare Tunnel or ngrok | — | n8n's built-in tunnel (`--tunnel`) is dev-only and rate-limited; Cloudflare Tunnel is free and persistent |
| Node.js (host) | Not required — Docker isolates runtime | — | Do not install n8n globally via npm on Windows; Docker is the only supported production path |

**Do not use npm global install on Windows.** Multiple community reports cite path separator issues (`\` vs `/`), missing sqlite3 native binaries, and broken node-gyp builds. Docker is the documented, tested path for Windows production.

---

## Key n8n Nodes

All nodes below are built-in (no extra installation). Verified present in n8n 2.x.

| Node | Type | Purpose in This Project | Key Notes |
|------|------|------------------------|-----------|
| **Schedule Trigger** | Trigger | Replaces Vercel Cron — runs `daily-media`, `daily-publish`, `check-status` on schedule | Formerly called "Cron" node; renamed in v0.199.0. Use CRON expression or interval UI. Requires `GENERIC_TIMEZONE` env var set correctly |
| **Webhook** | Trigger | Receives HTTP callbacks from Supabase Edge Functions (topic, research, asset, publish) | Supports GET/POST, header auth, HMAC validation via Code node. Must set `WEBHOOK_URL` env var for correct public URL in Docker |
| **HTTP Request** | Action | Calls external APIs: Claude, HeyGen, ElevenLabs, Gemini, Blotato, Canva, OpenAI | Supports all auth types (Bearer, API Key header, OAuth2). Use "Predefined Credential Type" for services n8n knows natively |
| **Supabase** | Action | CRUD on Supabase tables — read topics, update content_pieces, write published_log | Uses service_role key + project URL. Covers: Get Row, Get All Rows, Create Row, Update Row, Delete Row |
| **IF** | Logic | Branch on conditions (status == 'pending', content_hash match, quota check) | Standard boolean branching; connects to two output branches |
| **Switch** | Logic | Route by processing path (A/B/C/D/V) or content type (blog/social/video/audio) | Multi-branch; cleaner than nested IFs for 3+ paths |
| **Error Trigger** | Trigger | Starts a dedicated error-handling workflow on any upstream failure | Each workflow can designate one Error Workflow in Settings; Error Trigger must be the first node |
| **Execute Sub-workflow** | Action | Calls child workflows (e.g., invoke publish sub-workflow from orchestrator) | Caller passes JSON; child must start with Execute Sub-workflow Trigger. Errors in sub-workflow bubble to parent |
| **Execute Sub-workflow Trigger** | Trigger | Entry point for any workflow called as a sub-workflow | Replaces the old Start node for sub-workflows in n8n 2.x |
| **Code** | Action | Custom JS/Python logic — HMAC-SHA256 validation, payload transformation, workflow-lock checks | In n8n 2.x, env var access is blocked by default (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`). Pass secrets via input data instead |
| **Set** | Action | Rename/reshape fields between nodes, set static values | Ubiquitous glue node |
| **Wait** | Action | Pause workflow execution for a fixed time or until webhook resume | Useful for polling HeyGen/ElevenLabs async jobs |
| **Postgres** | Action | Direct PostgreSQL queries when Supabase node's CRUD isn't enough (raw SQL, transactions) | Connects to Supabase's pooler (port 6543) or direct connection (port 5432) |
| **Merge** | Action | Combine branches after IF/Switch nodes | Required when both branches must continue to a single next step |
| **Loop Over Items** | Action | Iterate arrays — e.g., process each content_piece in a batch | Equivalent to a forEach; outputs items one at a time or in batches |

---

## Credential Management

### How n8n Stores Credentials

n8n stores all credentials encrypted at rest using AES-256. The encryption key is set via the `N8N_ENCRYPTION_KEY` environment variable. Without a fixed key, n8n generates one on startup — meaning container restarts will break all saved credentials. **Always set a fixed `N8N_ENCRYPTION_KEY` in your `.env` file.**

### Two Tiers of Credentials

**Tier 1 — n8n Credential Store (recommended for all API keys)**

Create credentials once in the n8n UI under Settings > Credentials. Each credential is named, typed, and reusable across all workflows. Never paste API keys directly into node configuration fields.

Credential types relevant to this project:

| Service | n8n Credential Type | Fields |
|---------|--------------------|----|
| Supabase | Supabase API | Host (project URL), Service Role Secret |
| OpenAI / Claude | HTTP Header Auth or OpenAI API | API key as Bearer token |
| Gemini | HTTP Header Auth | API key header |
| HeyGen | HTTP Header Auth | `X-Api-Key` header |
| ElevenLabs | HTTP Header Auth | `xi-api-key` header |
| Blotato | HTTP Header Auth | API key header |
| Canva | OAuth2 or HTTP Header Auth | Depends on Canva API auth flow |
| PostgreSQL (direct) | Postgres | Host, port, DB name, user, password |

For HTTP Request nodes calling services without a native n8n credential type, use "Predefined Credential Type" if available, or "Header Auth" with your API key. This keeps the key out of the workflow JSON.

**Tier 2 — Environment Variables (for n8n system config only)**

System-level settings go in the `.env` file consumed by Docker Compose. These are NOT the same as workflow API keys:

```env
N8N_ENCRYPTION_KEY=<random-64-char-string>
N8N_USER_MANAGEMENT_JWT_SECRET=<random-string>
GENERIC_TIMEZONE=America/New_York
WEBHOOK_URL=https://your-tunnel-domain.com/
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=postgres
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=<strong-password>
```

Never put Supabase keys, Claude keys, or other workflow-level API keys in the Docker `.env`. Those belong in the n8n credential store so they are encrypted and auditable.

### Security Notes

- Exported workflow JSON files include credential **names and IDs** but NOT the secret values. Safe to commit to git.
- Access sharing: when you share a credential with another user/project inside n8n, they can use it but cannot read the underlying secret.
- Key rotation: update the credential in the n8n UI; all workflows using it pick up the new value immediately.

---

## Version Control

### Option A — Manual JSON Export (Free, Recommended for Solo/Small Team)

1. In n8n UI: open workflow > top-right menu (...) > Export > JSON.
2. Save file to `<project-root>/n8n-workflows/<workflow-name>.json`.
3. Commit to git normally.

Workflow JSON files contain: node configurations, connections, settings, and credential references (names/IDs only, no secrets). Safe to commit. Do NOT commit the `.env` file.

Recommended directory layout:

```
fhcontent-creator-v2/
  n8n-workflows/
    orchestrator-daily-media.json
    orchestrator-daily-publish.json
    orchestrator-check-status.json
    sub-topic-ingest.json
    sub-research.json
    sub-asset-gen.json
    sub-publish.json
    error-handler.json
    README.md          ← document credential names needed, not values
```

### Option B — Automated Backup Workflow (Free, Self-Hosted)

Build an n8n workflow that runs nightly: calls the n8n REST API to export all workflow JSONs, then uses the Git node to commit and push to a private GitHub repo. A community template exists for this (bidirectional GitHub sync). This is fully automatable without the Enterprise plan.

### Option C — Built-in Source Control (Enterprise Only)

n8n's native source control feature links to a Git repo and supports push/pull from the n8n UI. Requires Enterprise license. Not available on Community edition. Skip this for now.

### Key Constraints

- Workflow IDs are instance-specific UUIDs. When importing to a new instance, n8n assigns new IDs. Hardcoded workflow ID references in Execute Sub-workflow nodes will break — use workflow name references or update IDs post-import.
- Credentials must be recreated on each new instance — they are never exported in JSON. Document credential names in `n8n-workflows/README.md` so they can be recreated.
- Version compatibility: workflows exported from 2.x will not import cleanly into 1.x instances. Pin your Docker image version (`n8nio/n8n:2.9.0`) to prevent unintended upgrades from breaking imported workflows.

---

## Windows Self-Hosted Considerations

### Mandatory: Use Docker Desktop with WSL2 Backend

All n8n documentation and community consensus points to Docker + WSL2 as the only reliable Windows setup. Direct npm global install on Windows has persistent issues:
- `sqlite3` native module fails to build without Visual Studio Build Tools
- Windows file path separators (`\`) break internal n8n path handling in some node types
- Node.js version conflicts with other global tools

**Setup steps:**

1. Enable WSL2: `wsl --install` in PowerShell (admin), restart.
2. Install Docker Desktop, enable WSL2 backend in Settings > General.
3. Create `docker-compose.yml` and `.env` in a directory on your Windows filesystem (e.g., `D:\n8n\`).
4. Run `docker compose up -d` from that directory.
5. n8n UI accessible at `http://localhost:5678`.

### Timezone: Two Variables Required

n8n uses two separate timezone settings that must both be set:

```env
TZ=America/New_York               # OS-level timezone for the container
GENERIC_TIMEZONE=America/New_York # n8n Schedule Trigger node timezone
```

If only `GENERIC_TIMEZONE` is set, the Schedule Trigger fires at the right time but logs show UTC. If only `TZ` is set, the Schedule Trigger ignores it. Both must match.

### Webhook URLs in Local Development

When running locally, n8n generates webhook URLs as `http://localhost:5678/webhook/...`. External services (Supabase Edge Functions, HeyGen callbacks) cannot reach localhost. Two options:

- **Development**: Use `n8n start --tunnel` (n8n-provided tunnel, rate-limited, dev only).
- **Production/Stable dev**: Use Cloudflare Tunnel (free) or ngrok. Set `WEBHOOK_URL=https://your-tunnel-url.com/` in `.env` before starting n8n. n8n uses this value as the base URL for all webhook display and registration.

### Volume Persistence

By default, n8n stores data in the container's ephemeral filesystem. Always mount a named volume or host directory:

```yaml
volumes:
  - n8n_data:/home/node/.n8n
```

Or for direct host access (easier backup on Windows):

```yaml
volumes:
  - D:/n8n/data:/home/node/.n8n
```

Note: Windows host-path mounts can have permission issues. Named Docker volumes (`n8n_data:`) are more reliable and avoid the permission problem entirely. Access data via `docker volume inspect n8n_data`.

### n8n 2.x Security Defaults (Relevant for This Project)

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` (default in 2.x): Code nodes cannot read `process.env`. Do not rely on env vars for secrets inside Code nodes — pass values through workflow inputs or use Credential references.
- `ExecuteCommand` and `LocalFileTrigger` nodes are disabled by default. Do not plan to use them.
- HTML responses from Webhook nodes are auto-wrapped in `<iframe>` tags (since 1.103.0). If sending HTML payloads through webhooks, use JSON instead.

### Updating n8n

Pin the image version in `docker-compose.yml` to avoid accidental breaking upgrades:

```yaml
image: docker.n8n.io/n8nio/n8n:2.9.0
```

To upgrade: stop the stack, change the version tag, pull the new image, restart. Test with a non-production clone first. n8n ships weekly minor releases and has had multiple breaking changes across 1.x -> 2.x. The project should treat n8n version as a pinned dependency.

### Minimum Security Version

As of February 2026, **n8n 2.5.2 is the minimum safe version** due to multiple CVEs published in early 2026. Start at 2.9.0 and subscribe to the n8n security advisory channel.

---

## Confidence Levels

| Topic | Confidence | Notes |
|-------|-----------|-------|
| Current version (2.9.0, Feb 2026) | High | Confirmed via multiple sources including Releasebot and community reports |
| Docker + WSL2 as Windows deployment path | High | Universally recommended; documented officially |
| Schedule Trigger replaces Cron node | High | Renamed in v0.199.0, confirmed in docs |
| Supabase node uses service_role key | High | Documented in official n8n Supabase credentials guide |
| N8N_ENCRYPTION_KEY required for persistence | High | Core documented requirement; missing this breaks credentials on restart |
| Two timezone vars (TZ + GENERIC_TIMEZONE) | High | Community-confirmed; frequently cited gotcha |
| WEBHOOK_URL required for Docker webhook exposure | High | Documented; confirmed by multiple community posts |
| Manual JSON export is safe to git (no secret leakage) | High | Confirmed — credentials export as names/IDs only |
| Built-in source control = Enterprise only | High | Explicitly stated in docs |
| N8N_BLOCK_ENV_ACCESS_IN_NODE=true in 2.x | High | Documented 2.x breaking change |
| Cloudflare Tunnel as preferred webhook exposure | Medium | Community recommendation; no official endorsement, but well-established pattern |
| Sub-workflow ID portability issue | Medium | Documented behavior; workarounds exist (name-based lookup) but are version-dependent |
| PostgreSQL recommended over SQLite for production | Medium | Documented preference; SQLite is officially supported for dev/small installs |
| Weekly n8n release cadence | Medium | Observed pattern; not a formal commitment |

---

## Sources

- [n8n Releases (GitHub)](https://github.com/n8n-io/n8n/releases)
- [n8n Release Notes (Official Docs)](https://docs.n8n.io/release-notes/)
- [n8n 2.0 Breaking Changes](https://docs.n8n.io/2-0-breaking-changes/)
- [n8n Docker Installation Docs](https://docs.n8n.io/hosting/installation/docker/)
- [Schedule Trigger Node Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)
- [Webhook Node Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [Error Trigger Node Docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/)
- [Sub-workflows Docs](https://docs.n8n.io/flow-logic/subworkflows/)
- [Supabase Node Docs](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.supabase/)
- [Supabase Credentials Docs](https://docs.n8n.io/integrations/builtin/credentials/supabase/)
- [n8n Credential Management Guide](https://logicworkflow.com/blog/n8n-credential-management/)
- [n8n Source Control Docs](https://docs.n8n.io/source-control-environments/)
- [n8n Export/Import Workflows Docs](https://docs.n8n.io/workflows/export-import/)
- [n8n Security Best Practices (2025)](https://mathias.rocks/blog/2025-01-20-n8n-security-best-practices)
- [n8n Environment Variables Docs](https://docs.n8n.io/hosting/configuration/environment-variables/)
- [Webhook URL Configuration](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
- [n8n + Supabase (Supabase Partner Page)](https://supabase.com/partners/integrations/n8n)
- [n8n February 2026 Release Notes (Releasebot)](https://releasebot.io/updates/n8n)
- [Northflank: How to Self-Host n8n (2026)](https://northflank.com/blog/how-to-self-host-n8n-setup-architecture-and-pricing-guide)
- [n8n Security Advisory — Eight CVEs Feb 2026](https://www.geordie.ai/resources/technical-advisory-eight-new-n8n-cves-since-january---updated-remediation-guidance)
