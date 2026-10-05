/**
 * Quick Post has no topic and no source check. A sourced persona publishes only what passed
 * a source check, so Quick Post is refused for it before any model or platform call
 * (Codex review 2026-10-05, finding 5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
    persona: { id: 'p', name: 'Dr. Imani Carter', content_guardrail: 'sourced', platform_accounts: { tiktok: 'acct-tt' } } as Record<string, unknown>,
    inserts: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
    createAdminClient: () => ({
        from: (table: string) => ({
            select: () => ({ eq: () => ({ single: async () => ({ data: state.persona, error: null }) }) }),
            insert: async () => {
                state.inserts.push(table);
                return { error: null };
            },
        }),
    }),
}));
vi.mock('@/lib/claude', () => ({ claude: { generateContent: vi.fn(async () => ({ text: 'expanded', inputTokens: 1, outputTokens: 1 })) } }));
vi.mock('@/lib/openai', () => ({ openai: { generateImage: vi.fn() } }));
vi.mock('@/lib/blotato', () => ({
    blotato: { publishPost: vi.fn(async () => ({ postSubmissionId: 'post-1' })), uploadMediaBase64: vi.fn() },
    buildTarget: vi.fn(() => ({})),
}));

import { POST } from './route';
import { claude } from '@/lib/claude';
import { blotato } from '@/lib/blotato';
import { SOURCED_NO_QUICK_POST } from '@/lib/source-gate';

const post = (expandWithAI: boolean) => POST(new NextRequest('https://example/api/content/quick-post', {
    method: 'POST',
    body: JSON.stringify({
        personaId: '11111111-1111-4111-8111-111111111111',
        text: 'In 1867 Norfolk elected him.',
        platforms: ['tiktok'],
        expandWithAI,
    }),
}));

describe('Quick Post and sourced personas', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.inserts = [];
        state.persona = { id: 'p', name: 'Dr. Imani Carter', content_guardrail: 'sourced', platform_accounts: { tiktok: 'acct-tt' } };
    });

    it.each([true, false])('refuses a sourced persona and calls nothing (expandWithAI %p)', async (expandWithAI) => {
        const response = await post(expandWithAI);

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ success: false, error: SOURCED_NO_QUICK_POST });
        expect(claude.generateContent).not.toHaveBeenCalled();
        expect(blotato.publishPost).not.toHaveBeenCalled();
        expect(state.inserts).toHaveLength(0);
    });

    it('still posts for a persona that is not sourced', async () => {
        state.persona = { ...state.persona, content_guardrail: 'none' };

        const response = await post(false);

        expect(response.status).toBe(200);
        expect(blotato.publishPost).toHaveBeenCalledTimes(1);
    });
});
