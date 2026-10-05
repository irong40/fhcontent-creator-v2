/**
 * No paid render for a text that has not passed its source check, or that changed after it
 * passed (Codex review 2026-10-05, finding 6). Before this a topic written on demand landed
 * content_ready with no review hold, and the media cron rendered it unchecked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
    cleared: false as unknown,
    paid: vi.fn(),
    tables: [] as string[],
    asked: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
    createAdminClient: () => ({
        rpc: async (fn: string, args: { p_topic: string }) => {
            state.asked.push(`${fn}:${args.p_topic}`);
            return { data: state.cleared, error: null };
        },
        from: (table: string) => {
            state.tables.push(table);
            const chain = {
                select: () => chain,
                in: () => chain,
                or: () => chain,
                lte: () => chain,
                // the topics query ends in order(); the content_pieces query ends in eq()
                order: async () => ({
                    data: [{ id: 'topic-1', title: 'Unchecked', status: 'content_ready', requires_review: false, persona_id: 'persona', personas: {} }],
                    error: null,
                }),
                eq: async () => ({ data: [], error: null }),
            };
            return chain;
        },
    }),
}));
vi.mock('../middleware', () => ({ validateCronSecret: () => true }));
vi.mock('@/lib/workflow-lock', () => ({ acquireLock: async () => 'lock', releaseLock: vi.fn() }));
vi.mock('@/lib/blotato', () => ({ blotato: { createVideoFromPrompt: state.paid } }));
vi.mock('@/lib/openai', () => ({ openai: {} }));
vi.mock('@/lib/gemini', () => ({ gemini: {} }));
vi.mock('@/lib/claude', () => ({ claude: {} }));
vi.mock('@/lib/storage', () => ({ uploadAudio: state.paid, uploadImage: state.paid }));
vi.mock('@/lib/utils', () => ({ estimateDalleCost: () => 0 }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn() }));
vi.mock('@/lib/carousel-slide', () => ({ generateSlideWithLadder: state.paid, serializeAttempts: vi.fn() }));
vi.mock('@/lib/photo-provider', () => ({ generatePhotoCascade: state.paid }));
vi.mock('@/lib/archival', () => ({ buildArchivalQueries: vi.fn(), findArchivalImages: state.paid, ARCHIVAL_AUDIT_RULES: '' }));
vi.mock('@/lib/huva-template', () => ({ renderHuvaSlide: state.paid }));
vi.mock('@/lib/quote-template', () => ({ renderQuoteCard: state.paid }));

import { GET } from './route';

describe('the media cron asks the source gate before it renders', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.tables = [];
        state.asked = [];
    });

    it('skips a topic with no passing check before it reads a single piece', async () => {
        state.cleared = false;

        const res = await GET(new Request('https://fixture/api/cron/daily-media'));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.processed).toBe(0);
        expect(body.sourceBlocked).toHaveLength(1);
        expect(body.sourceBlocked[0]).toMatchObject({ topicId: 'topic-1', reason: expect.stringContaining('Source check required') });
        expect(state.asked).toEqual(['topic_source_cleared:topic-1']);
        expect(state.tables).toEqual(['topics']);
        expect(state.paid).not.toHaveBeenCalled();
    });

    it('goes on to the pieces of a topic that passed', async () => {
        state.cleared = true;

        const res = await GET(new Request('https://fixture/api/cron/daily-media'));
        const body = await res.json();

        expect(body.sourceBlocked).toBeUndefined();
        expect(state.tables).toEqual(['topics', 'content_pieces']);
    });
});
