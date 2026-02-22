# Content Command Center — Faith & Harmony LLC

## Project Overview
Automated content production system for Faith & Harmony LLC. One historical topic per brand per week generates 6+ content pieces (long-form video, 4 short videos, carousel, podcast, newsletter draft) published across 8 platforms automatically.

**Lead Brand**: History Unveiled VA (African American history in Virginia)
**Total Brands**: 6 (phased launch)
**Supabase Project**: `qjpujskwqaehxnqypxzu`

## Tech Stack
- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5
- **Styling**: Tailwind CSS v4, Shadcn/ui (Radix), Lucide icons, Sonner toasts
- **Database**: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **AI**: Claude Sonnet 4.5 (content gen), Gemini Imagen 3 (image gen)
- **Video**: HeyGen (avatar long-form), Blotato (faceless shorts + carousel + 8-platform publish)
- **Audio**: ElevenLabs (TTS, podcast narration), AceStep 1.5 (music beds, local)
- **Newsletter**: Substack (free tier per brand)
- **Orchestration**: n8n (self-hosted) for automation; Vercel Cron for scheduling
- **Deployment**: Vercel

## Architecture
```
Saturday Planning (Next.js UI) → Webhook → n8n Execution Pipeline
                                              ↓
                              Topic Gen → Research → Script → Media → Publish
                                              ↓
                              Callbacks → Supabase Edge Functions → DB Status Updates
                                              ↓
                              Next.js Dashboard ← Real-time monitoring
```

### Brand Hierarchy
brands → personas → topics → content_pieces → (audio_assets, visual_assets, published_log)

### Content Per Topic
| Type | Vendor | Details |
|------|--------|---------|
| Long-form video | HeyGen | 2-3 min, avatar persona, ElevenLabs voice |
| 4 Short videos | Blotato | 30 sec faceless, different hooks |
| Carousel | Blotato + Gemini | 8-10 slides, AI-generated backgrounds |
| Podcast | ElevenLabs | 20-35 min deep dive, per-brand RSS |
| Newsletter | Claude → Substack | Auto-drafted from long-form script |
| Music bed | AceStep 1.5 | Brand signature, local generation |

## Key Directories
```
src/app/api/          — API routes (content, topics, media, cron, analytics, podcast)
src/app/              — Pages (dashboard, plan, review, personas, costs, login)
src/components/       — UI components (shadcn + custom)
src/lib/              — Service clients (blotato, heygen, elevenlabs, gemini, claude, prompts, schemas)
src/lib/supabase/     — Supabase client (browser) and server (SSR + admin)
src/types/            — TypeScript types (database.ts generated from schema)
src/scripts/          — Seed and migration scripts
supabase/migrations/  — SQL migrations (NEVER edit applied migrations, always create new)
supabase/functions/   — Supabase Edge Functions (Deno, n8n callbacks)
```

## Database Tables
| Table | Purpose |
|-------|---------|
| brands | Brand config (platform accounts, CTA template, music style) |
| personas | Creator personas per brand (HeyGen avatar, voice, newsletter) |
| topics | Weekly topic containers with status tracking |
| content_pieces | 6 pieces per topic (long, short_1-4, carousel) |
| podcast_episodes | Per-brand podcast episodes with RSS guid |
| audio_assets | ElevenLabs TTS results |
| visual_assets | Images, thumbnails, carousel designs |
| voices | ElevenLabs voice rotation pool |
| published_log | Duplicate check tracking |
| cost_tracking | API usage and cost monitoring |
| performance_metrics | Platform analytics (views, likes, shares, saves) |
| content_ideas | Pre-pipeline topic backlog |
| workflow_locks | Concurrent execution prevention |

## Environment Variables
See `.env.example` for full list. Required:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- `BLOTATO_API_KEY`, `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`
- `CRON_SECRET` (Vercel cron auth)
- `N8N_WEBHOOK_SECRET` (Edge Function HMAC validation)

## Conventions
- **Migrations**: Always create NEW files (002_, 003_, etc). Never edit applied migrations.
- **Types**: `src/types/database.ts` mirrors Supabase schema. Update after every migration.
- **API Routes**: Use Zod validation (schemas.ts). Admin client for server-side DB ops.
- **Edge Functions**: Deno-based in `supabase/functions/`. HMAC-SHA256 validated.
- **Cron Jobs**: Protected by CRON_SECRET header. Workflow locks prevent concurrent runs.
- **Testing**: Vitest (`npm test`). Spec files co-located with source.
- **RLS**: All tables have RLS enabled. Authenticated users have full access (single-operator system).

## Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run test         # Run vitest
npm run test:watch   # Watch mode
npm run lint         # ESLint
```

## Cron Schedule (Vercel)
| Job | Schedule | Purpose |
|-----|----------|---------|
| /api/cron/daily-media | 6 AM daily | Generate media assets |
| /api/cron/daily-publish | Hourly | Publish scheduled content |
| /api/cron/check-status | Every 10 min | Poll HeyGen/Blotato status, clean stale locks |
