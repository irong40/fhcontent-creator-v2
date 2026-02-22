# Technology Stack

**Analysis Date:** 2026-02-22

## Languages

**Primary:**
- TypeScript 5.x - All application code (`src/`), config files (`next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`)

**Secondary:**
- SQL - Supabase migrations (`supabase/migrations/*.sql`)
- TypeScript (Deno runtime) - Supabase Edge Functions (`supabase/functions/**/*.ts`)

## Runtime

**Environment:**
- Node.js 20.x (inferred from `@types/node: ^20`)

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- Next.js 16.1.6 - Full-stack React framework; App Router pattern; API routes under `src/app/api/`
- React 19.2.3 - UI rendering

**CSS:**
- Tailwind CSS 4.x - Utility-first CSS, configured via `@tailwindcss/postcss` plugin in `postcss.config.mjs`

**Testing:**
- Vitest 4.x - Unit test runner; config at `vitest.config.ts`; test environment: `node`; test files: `src/**/*.spec.ts`

**Build/Dev:**
- ESLint 9 - Linting via `eslint.config.mjs` with `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- PostCSS - CSS processing via `postcss.config.mjs`
- `@vitejs/plugin-react` 5.x - Vite/Vitest React transform

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk` ^0.74.0 - Official Anthropic SDK; used in `src/lib/claude.ts` for Claude content generation (model: `claude-sonnet-4-5-20250929`)
- `@supabase/supabase-js` ^2.95.3 - Supabase JS client
- `@supabase/ssr` ^0.8.0 - Supabase SSR helpers for Next.js cookie-based auth; used in `src/lib/supabase/client.ts` and `src/lib/supabase/server.ts`
- `@google/genai` ^1.41.0 - Google Generative AI SDK; used in `src/lib/gemini.ts` for Gemini content generation and Lyria music generation
- `zod` ^4.3.6 - Schema validation; used in `src/lib/schemas.ts`

**UI:**
- `radix-ui` ^1.4.3 - Headless UI primitives
- `lucide-react` ^0.564.0 - Icon library
- `class-variance-authority` ^0.7.1 - Component variant management
- `clsx` ^2.1.1 - Conditional class names
- `tailwind-merge` ^3.4.0 - Tailwind class deduplication
- `tw-animate-css` ^1.4.0 - CSS animations for Tailwind
- `sonner` ^2.0.7 - Toast notification library

**Media Processing:**
- `@breezystack/lamejs` ^1.2.7 - MP3 encoding in-browser/Node; used in `src/lib/gemini.ts` to encode Lyria PCM output to MP3

## Configuration

**Environment:**
- `.env.local` for local development (gitignored)
- `.env.example` documents all required variables
- Key required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `BLOTATO_API_KEY`, `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`, `CANVA_API_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `N8N_WEBHOOK_SECRET`
- Optional vars: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NOTIFICATION_EMAIL`, `N8N_ERROR_WEBHOOK_URL`

**Build:**
- `next.config.ts` - Minimal Next.js config (no custom rules active)
- `tsconfig.json` - Strict TypeScript; path alias `@/*` → `./src/*`; target ES2017
- `vercel.json` - Defines 3 Vercel Cron jobs (no SPA rewrite rules needed; SSR app)

**Supabase:**
- CLI-managed migrations in `supabase/migrations/`
- Deno-based Edge Functions in `supabase/functions/`
- Project ref: `qjpujskwqaehxnqypxzu`

## Platform Requirements

**Development:**
- Node.js 20+
- Supabase CLI (for migrations and Edge Function deployment)
- npm

**Production:**
- Vercel (inferred from `vercel.json` and `VERCEL_ENV` env var usage)
- Supabase hosted (PostgreSQL 16 + Storage + Edge Functions + Auth)

---

*Stack analysis: 2026-02-22*
