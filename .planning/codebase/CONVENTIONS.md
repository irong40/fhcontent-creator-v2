# Coding Conventions

**Analysis Date:** 2026-02-22

## Naming Patterns

**Files:**
- React page components: `page.tsx` (Next.js App Router convention)
- React shared components: `kebab-case.tsx` — e.g., `persona-card.tsx`, `quick-post-dialog.tsx`
- API route files: `route.ts` at `src/app/api/[resource]/[id]/[action]/route.ts`
- Library modules: `kebab-case.ts` — e.g., `blotato.ts`, `workflow-lock.ts`
- Helper co-location: `helpers.ts` / `helpers.spec.ts` placed beside `route.ts` in the same directory
- Test files: `[module].spec.ts` co-located with `[module].ts`

**Functions:**
- camelCase for all functions: `buildTarget`, `validateCronSecret`, `getTargetPlatforms`
- `build*` prefix for prompt/payload constructors: `buildTopicPrompt`, `buildContentPrompt`, `buildRemixPrompt`, `buildTarget`
- `get*` prefix for data retrievers: `getTargetPlatforms`, `getMediaUrl`, `getCarouselUrls`
- `is*` prefix for boolean predicates: `isTextOnlyPlatform`
- `estimate*` prefix for cost calculators: `estimateClaudeCost`, `estimateElevenLabsCost`, `estimateDalleCost`
- `create*` prefix for Supabase client factories: `createAdminClient`, `createClient`
- `test*` prefix used on API client methods for health checks: `testConnection`

**Variables:**
- camelCase throughout: `topicId`, `contentPieceId`, `publishDate`
- Acronyms treated as words: `apiKey` not `APIKey`, `costUsd` not `costUSd`
- Boolean flags follow `is*`/`has*`: `isAiGenerated`, `isBrandedContent`, `is_active`

**Types and Interfaces:**
- PascalCase for all: `PersonaCard`, `ServiceResult`, `BlotatoTarget`, `TopicWithPersona`
- Interface names are descriptive nouns: `BlotatoPublishRequest`, `PlatformAccounts`, `HistoricalPoint`
- Zod schema variables: camelCase with `Schema` suffix: `topicGenerateSchema`, `contentResponseSchema`
- Inferred Zod types: PascalCase exported as `type`: `TopicGenerateRequest`, `ContentUpdateRequest`
- Union type aliases: PascalCase: `PieceType`, `TopicStatus`, `PieceStatus`, `Platform`

**Database row type aliases** (in `src/types/database.ts`):
- Convenience row types: `type Persona = Database['public']['Tables']['personas']['Row']`
- Insert types: `PersonaInsert`, `TopicInsert`
- Update types: `PersonaUpdate`, `TopicUpdate`
- Join types (nested Supabase selects): `TopicWithPersona` — extends base row with nested relation

**Constants:**
- SCREAMING_SNAKE_CASE for module-level constants: `PIECE_ORDER`, `TAB_LABELS`, `VIDEO_PIECE_TYPES`, `RESPONSE_SCHEMAS`

## Code Style

**Formatting:**
- No Prettier config detected — defer to ESLint
- 4-space indentation in `.ts` files
- 2-space indentation in UI component `.tsx` files (Shadcn convention)
- Single quotes for strings in TypeScript: `'use client'`, `'clerk'`, `'POST'`
- Trailing commas used consistently in multi-line structures

**Linting:**
- ESLint via `eslint.config.mjs` — extends `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- No additional custom rules beyond Next.js defaults

## Import Organization

**Order (observed pattern):**
1. Next.js and React internals: `next/server`, `next/navigation`, `react`
2. External packages: `@anthropic-ai/sdk`, `@supabase/ssr`, `zod`, `sonner`
3. Internal `@/lib/*` modules
4. Internal `@/components/*` modules
5. Internal `@/types/*` type imports (often using `import type`)

**Path Aliases:**
- `@/*` maps to `./src/*` — defined in both `tsconfig.json` and `vitest.config.ts`
- Use `@/lib/supabase/server` for server-side Supabase, `@/lib/supabase/client` for client-side

**Type-only imports:**
- Always use `import type` for type-only imports: `import type { Persona } from '@/types/database'`
- Enforced by TypeScript + Next.js ESLint rules

## API Route Patterns

**Structure — every route file follows this shape:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { someSchema } from '@/lib/schemas';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },  // dynamic segments
) {
    try {
        const { id } = await params;                   // await params (Next.js 15+)
        const body = await request.json();
        const validated = someSchema.parse(body);       // Zod parse — throws on invalid

        // ... business logic ...

        return NextResponse.json({ success: true, ... });
    } catch (error) {
        console.error('[route name] error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 },
        );
    }
}
```

**Response shape:** Always `{ success: boolean, ... }` at top level. Errors include `error: string`.

**Validation at entry:** All routes parse request body with Zod schema before any DB access. Use `.parse()` for required fields (throws → caught by outer try/catch), `.safeParse()` for conditional logic where you inspect errors.

**Dynamic params:** Always `{ params: Promise<{ id: string }> }` and `await params` — Next.js 15 App Router pattern.

## Error Handling

**Patterns:**
- Outer `try/catch` on all API route handlers — catches both Zod validation errors and runtime errors
- Inner try/catch only where a specific recovery action is needed (e.g., reverting topic status on AI parse failure — `src/app/api/content/generate/route.ts` lines 53-62)
- Supabase errors checked via `{ data, error }` destructure: `if (error || !data) return 404`
- External service errors caught with `e instanceof Error ? e.message : 'Unknown error'` pattern used everywhere
- Never throw raw strings — always `Error` instances or forward the `.message`
- `console.error` before every `return 500` in route handlers

**Status codes:**
- 400: invalid business state (wrong status for transition)
- 404: record not found
- 500: internal/DB error
- 502: AI service returned bad data (invalid JSON or schema mismatch)

## Logging

**Framework:** `console.error` (no structured logging library)

**Patterns:**
- `console.error('[context] error:', error)` at every catch boundary in route handlers
- No `console.log` in production paths — only `console.error`
- API health endpoint (`src/app/api/health/route.ts`) captures latency via `Date.now()` diff

## Comments

**When to Comment:**
- JSDoc-style block comments at top of service client files to document API source:
  ```typescript
  /**
   * Blotato API Client
   * Official API integration based on: https://help.blotato.com/api/api-reference
   */
  ```
- Section banners using `// ===...===` dividers in large files with multiple logical sections (e.g., `src/lib/blotato.ts`)
- Inline comments on non-obvious logic: business rules, distribution matrices, pricing rates
- `// Pricing: $X/unit` comments on cost utility functions

**Inline comments preferred over JSDoc for:**
- Constants that encode business rules: `/** Claude Sonnet 4.5 pricing: $3/M input, $15/M output */`
- Non-obvious algorithm steps

## Service Client Pattern

All external API integrations follow this pattern:

```typescript
class ServiceClient {
    private readonly apiKey: string;   // private, readonly

    constructor() {
        this.apiKey = process.env.SERVICE_API_KEY || '';
    }

    async testConnection(): Promise<{ ok: boolean; error?: string }> {
        try { /* minimal API call */ return { ok: true }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' }; }
    }

    private async request<T>(endpoint: string, ...): Promise<T> { ... }
}

export const serviceName = new ServiceClient();  // singleton export
```

Files: `src/lib/claude.ts`, `src/lib/blotato.ts`, `src/lib/heygen.ts`, `src/lib/elevenlabs.ts`, `src/lib/gemini.ts`, `src/lib/openai.ts`

## Component Patterns

**Server Components (default in App Router):**
- No `'use client'` directive
- Fetch data directly via `createAdminClient()` or pass via props
- Example: `src/components/persona-card.tsx`

**Client Components:**
- Always declare `'use client'` as first line
- Data fetching via `createClient()` in `useEffect` with `Promise.all` for parallel queries
- `useMemo(() => createClient(), [])` pattern to avoid re-creating the Supabase client
- `useCallback` for data-loading functions used as deps
- State initialized with typed literals: `useState<Persona[]>([])`, `useState<string | null>(null)`
- Loading states as `useState(true)` with early return spinner

**Component file shape:**
```typescript
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
// ... other imports ...

interface ComponentProps {
    propName: PropType;
}

export function ComponentName({ propName }: ComponentProps) {
    // state declarations
    // derived values
    // effects
    // handlers
    // render
}
```

Pages use `export default function PageName()`, components use `export function ComponentName()`.

## Module Design

**Exports:**
- Libraries export a singleton instance: `export const claude = new ClaudeClient()`
- Utility functions exported individually (no barrel): `export function estimateClaudeCost(...)`
- Types exported inline: `export type RegeneratePieceResponse = z.infer<typeof schema>`

**Barrel Files:**
- No barrel `index.ts` files — import directly from the module file
- `src/types/database.ts` acts as the single source for all database types

**Zod Schema conventions:**
- Schemas grouped in `src/lib/schemas.ts` with section comments (`// --- Request schemas ---`, `// --- Claude response schemas ---`)
- Every schema has a matching inferred type exported: `export type Foo = z.infer<typeof fooSchema>`
- DB column names use `snake_case` (matching Supabase), API/AI response fields use `camelCase`

---

*Convention analysis: 2026-02-22*
