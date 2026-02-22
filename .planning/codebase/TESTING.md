# Testing Patterns

**Analysis Date:** 2026-02-22

## Test Framework

**Runner:**
- Vitest 4.x
- Config: `vitest.config.ts` (project root)

**Assertion Library:**
- Vitest built-ins: `expect`, `toEqual`, `toBe`, `toBeCloseTo`, `toHaveLength`, `toMatchObject`, `toContain`, `toBeUndefined`, `toBeNull`, `toBeGreaterThan`, `toMatch`, `toHaveBeenCalledOnce`, `toHaveBeenCalledWith`, `resolves`, `rejects`

**Run Commands:**
```bash
npm run test          # Run all specs once (vitest run)
npm run test:watch    # Interactive watch mode (vitest)
```

No coverage command is configured in `package.json`. Coverage tooling is not yet set up.

## Test File Organization

**Location:**
- Co-located with the module under test in the same directory
- Pattern: `[module].spec.ts` lives next to `[module].ts`

**Examples:**
- `src/lib/utils.ts` + `src/lib/utils.spec.ts`
- `src/lib/schemas.ts` + `src/lib/schemas.spec.ts` + `src/lib/schemas-approval.spec.ts`
- `src/lib/blotato.ts` + `src/lib/blotato.spec.ts`
- `src/lib/gemini.ts` + `src/lib/gemini.spec.ts`
- `src/lib/notifications.ts` + `src/lib/notifications.spec.ts`
- `src/lib/prompts.ts` + `src/lib/prompts.spec.ts`
- `src/app/api/cron/middleware.ts` + `src/app/api/cron/middleware.spec.ts`
- `src/app/api/cron/daily-publish/helpers.ts` + `src/app/api/cron/daily-publish/helpers.spec.ts`
- `src/app/api/cron/daily-publish/route.ts` + `src/app/api/cron/daily-publish/publish.spec.ts`
- `src/app/costs/helpers.ts` + `src/app/costs/helpers.spec.ts`

**Glob pattern** (vitest config): `src/**/*.spec.ts`

**Naming:**
- One spec file per source file (exceptions: `schemas.spec.ts` + `schemas-approval.spec.ts` split a large schema file)
- File name matches the module exactly: `utils.spec.ts` tests `utils.ts`

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect } from 'vitest';
import { functionUnderTest } from './module';

describe('functionUnderTest', () => {
    it('describes the expected behavior', () => {
        expect(functionUnderTest(input)).toBe(expectedOutput);
    });

    it('handles edge case', () => {
        const result = functionUnderTest.safeParse({ field: 'bad' });
        expect(result.success).toBe(false);
    });
});
```

**Multiple describe blocks per file** — one per exported function/class method:
```typescript
describe('estimateClaudeCost', () => { ... });
describe('wordCount', () => { ... });
describe('estimateDuration', () => { ... });
```

**Nested describe** used for grouping related schemas under one parent:
```typescript
describe('media generation schemas', () => {
    describe('musicGenerateSchema', () => { ... });
    describe('voiceGenerateSchema', () => { ... });
});
```

**Patterns:**
- `beforeEach` for environment variable cleanup: `delete process.env.CRON_SECRET`
- `afterEach` for restoring globals: `global.fetch = originalFetch`
- No shared setup across describe blocks — each suite is self-contained
- Test data declared at describe-block scope as `const`: `const validTopic = { ... }`

## Mocking

**Framework:** Vitest's `vi` module (`import { vi } from 'vitest'`)

**Patterns:**

Mocking `global.fetch` for webhook/HTTP tests:
```typescript
import { vi, beforeEach, afterEach } from 'vitest';

describe('notifyError', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue(new Response('ok'));
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('sends POST to webhook URL', async () => {
        process.env.N8N_ERROR_WEBHOOK_URL = 'https://example.com/webhook';
        await notifyError({ source: 'test', message: 'fail' });

        const [url, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe('https://example.com/webhook');
        expect(options.method).toBe('POST');
    });

    it('handles fetch failure gracefully', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
        await expect(notifyError({ source: 'test', message: 'fail' })).resolves.toBeUndefined();
    });
});
```

File: `src/lib/notifications.spec.ts`

**What to Mock:**
- `global.fetch` when testing code that calls external HTTP endpoints
- `process.env` variables via direct assignment/deletion in `beforeEach`/`afterEach`

**What NOT to Mock:**
- Supabase client (no DB mocking — tests stay unit-focused on pure functions)
- AI SDK clients (tests target pure exported functions, not class methods that call external APIs)
- Internal library modules — import and test directly

**No `vi.mock()` module-level mocking detected** — the codebase isolates side effects by testing pure functions and pure factory functions separately from the client classes.

## Fixtures and Factories

**Test Data:**
- Declared inline at `describe` scope as typed `const` objects
- Full shape provided (all required fields) matching the TypeScript type:

```typescript
const VALID_UUID = '6ac9adfa-27f1-492b-98e1-f5623cb4eda2';

const mockPersona: Persona = {
    id: '6ac9adfa-27f1-492b-98e1-f5623cb4eda2',
    name: 'Dr. Imani Carter',
    brand: 'History Unveiled VA',
    // ... all fields explicitly set
};

const mockTopic: Topic = {
    id: 'topic-uuid-1234',
    persona_id: mockPersona.id,
    // ... all fields explicitly set
};
```

- Factory helpers used for repeated variations: `const makePiece = (pieceType: string) => ({ ... })`
- Spread with override pattern for variants: `{ ...validTopic, historicalPoints: validTopic.historicalPoints.slice(0, 3) }`

**Location:**
- Inline in each spec file — no shared fixture file

## Coverage

**Requirements:** None enforced (no coverage threshold configured, no `--coverage` script)

**View Coverage:**
```bash
npx vitest run --coverage   # not configured by default — add @vitest/coverage-v8 to use
```

## Test Types

**Unit Tests:**
- All 11 spec files are unit tests
- Test pure functions in isolation: utility math, schema validation, prompt builders, target builders
- No HTTP calls in any test — external APIs are tested via their pure helper functions only
- Zod schemas tested via `.parse()` (throws) and `.safeParse()` (returns `success: boolean`)

**Integration Tests:**
- None present — no integration test infrastructure

**E2E Tests:**
- Not used — no Playwright, Cypress, or similar framework installed

## Common Patterns

**Parameterized tests with `it.each`:**
```typescript
it.each([
    'short_1', 'short_2', 'short_3', 'short_4',
] as const)('returns 6 platforms for %s', (pieceType) => {
    expect(getTargetPlatforms(pieceType)).toHaveLength(6);
});

// Also used for field validation:
it.each([
    'script', 'caption_long', 'caption_short', 'thumbnail_prompt', 'carousel_slides',
])('accepts valid field "%s"', (field) => {
    expect(remixRequestSchema.parse({ field }).field).toBe(field);
});
```

Files: `src/app/api/cron/daily-publish/helpers.spec.ts`, `src/lib/schemas.spec.ts`

**Async Testing:**
```typescript
it('sends POST to webhook', async () => {
    await notifyError({ source: 'daily-publish', message: 'fail' });
    expect(global.fetch).toHaveBeenCalledOnce();
});

it('resolves without throwing on network failure', async () => {
    await expect(notifyError({ source: 'test', message: 'fail' })).resolves.toBeUndefined();
});
```

**Error/Rejection Testing:**
```typescript
// For Zod schemas — use safeParse for assertions without throws:
it('rejects invalid UUID', () => {
    const result = schema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
});

// Alternatively use expect().toThrow():
it('requires publishDate', () => {
    expect(() => scheduleTopicSchema.parse({})).toThrow();
});
```

**Request factory helpers** (for HTTP handler tests):
```typescript
function makeRequest(authHeader?: string): Request {
    const headers = new Headers();
    if (authHeader) headers.set('authorization', authHeader);
    return new Request('http://localhost/api/cron/daily-media', { headers });
}
```

File: `src/app/api/cron/middleware.spec.ts`

**Floating-point assertions:**
```typescript
// Always use toBeCloseTo for cost/financial calculations:
expect(estimateClaudeCost(7000, 2000)).toBeCloseTo(0.051, 6);
expect(aggregateByService(rows).grandTotal).toBeCloseTo(0.30);
```

**Boundary testing:**
```typescript
it('boundary: 149 words stays in seconds', () => {
    expect(estimateDuration(149)).toMatch(/^\d+s$/);
});
it('boundary: 150 words switches to minutes', () => {
    expect(estimateDuration(150)).toMatch(/min$/);
});
```

## What Is and Is Not Tested

**Tested:**
- All utility functions in `src/lib/utils.ts`
- All Zod schemas in `src/lib/schemas.ts`
- Pure helper functions extracted from route directories (`helpers.ts` files)
- `buildTarget` factory in `src/lib/blotato.ts`
- Prompt builder functions in `src/lib/prompts.ts`
- `validateCronSecret` in `src/app/api/cron/middleware.ts`
- `notifyError` in `src/lib/notifications.ts`
- `pcmToMp3` audio conversion in `src/lib/gemini.ts`
- Cost aggregation helpers in `src/app/costs/helpers.ts`

**Not Tested (coverage gaps):**
- API route handlers themselves (`route.ts` files) — no mock for Supabase or AI clients in route context
- React page and component rendering — no React Testing Library or jsdom configured
- Supabase client initialization (`src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`)
- Service client class methods that call external APIs (`claude.generateContent`, `blotato.publishPost`, etc.)
- Middleware (`src/middleware.ts`)
- Cron route logic (`src/app/api/cron/daily-publish/route.ts`, `daily-media`, `check-status`)

---

*Testing analysis: 2026-02-22*
