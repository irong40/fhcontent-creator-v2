import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ generate: vi.fn(), judge: vi.fn(), release: vi.fn(), updates: [] as Record<string, unknown>[], guards: [] as Array<[string, unknown]>, inserts: [] as unknown[], deletes: [] as string[], trails: [] as unknown[], heldOn: null as string | null, existing: 0, topic: {} as Record<string, unknown> }));
vi.mock('@/lib/content-inference', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/content-inference')>(), generateQueuedContent: state.generate }));
vi.mock('@/lib/claim-check', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/claim-check')>(), callJudge: state.judge }));
vi.mock('@/lib/local-inference-queue', () => ({ LocalInferencePendingError: class extends Error {} }));
vi.mock('@/lib/prompts', () => ({ buildContentPrompt: () => ({ system: 'system', user: 'source' }) }));
vi.mock('@/lib/notifications', () => ({ notifyError: vi.fn() }));
vi.mock('@/lib/draft-hold', () => ({ releaseDraftHolds: state.release }));
vi.mock('@/lib/workflow-lock', () => ({ acquireLock: async () => 'lock', releaseLock: vi.fn() }));
vi.mock('../middleware', () => ({ validateCronSecret: () => true }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: () => ({ from: (table: string) => {
    let response: unknown = { error: null };
    const chain = {
        select: (_fields?: string, options?: unknown) => { if (options) response = { count: state.existing }; return chain; },
        eq: () => chain, in: (col: string, vals: unknown) => { state.guards.push([col, vals]); return chain; }, not: () => chain, or: () => chain, order: () => chain,
        limit: () => { response = { data: [{ id: 'fixture', title: 'Source', retry_count: 0, personas: { name: 'Fixture', content_format: 'standard' }, ...state.topic }], error: null }; return chain; },
        update: (value: Record<string, unknown>) => { state.updates.push(value); response = { data: state.heldOn !== null && value.status === state.heldOn ? [] : [{ id: 'fixture' }], error: null }; return chain; },
        delete: () => { state.deletes.push(table); return chain; },
        insert: (value: unknown) => {
            if (table === 'content_pieces') { state.inserts.push(value); response = { data: (value as unknown[]).map((_, i) => ({ id: `piece-${i}` })), error: null }; }
            if (table === 'judge_trail') state.trails.push(value);
            return chain;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
    }; return chain;
} }) }));
import { GET } from './route';
import { LocalInferencePendingError } from '@/lib/local-inference-queue';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); state.updates.length = 0; state.guards.length = 0; state.inserts.length = 0; state.deletes.length = 0; state.trails.length = 0; state.heldOn = null; state.existing = 0; state.topic = {}; });
describe('local content consumption', () => {
    it('leaves queued work selectable without charging retries or inserting content', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.generate.mockRejectedValue(new LocalInferencePendingError('fixture'));
        const response = await GET(new Request('https://fixture/api/cron/content-generator'));
        expect((await response.json()).results[0].queued).toBe(true);
        expect(state.updates).toEqual([{ status: 'draft' }]);
        expect(state.inserts).toHaveLength(0);
    });
    it('inserts a complete batch together and holds local output for review', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        const response = await GET(new Request('https://fixture/api/cron/content-generator'));
        expect((await response.json()).results[0].piecesInserted).toBe(6);
        expect(state.inserts).toHaveLength(1);
        expect(state.inserts[0]).toHaveLength(6);
        expect(state.updates.at(-1)).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
    });
    it('holds cloud output for review too; never writes scheduled past the source gate', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.updates.at(-1)).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
        expect(state.updates.some(u => u.status === 'scheduled')).toBe(false);
    });
    const sourcedPieces = () => ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: 'James was a double agent for the British' }));
    const lafayettePoint = { claim: 'James pretended to spy for the British but repeated to Lafayette what he overheard.', quote: 'James pretended to spy for the British but repeated to Lafayette what he overheard.', source: 'DVB', year: '1781' };

    const gen = () => state.generate.mockResolvedValueOnce({ text: JSON.stringify({ pieces: sourcedPieces() }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });

    it('rejects a sourced draft when the judge finds one piece unsupported, and says why', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        gen();
        state.judge
            .mockResolvedValueOnce('{"unsupported":[]}')
            .mockResolvedValueOnce('{"unsupported":[{"claim":"double agent for the British","reason":"he only pretended"}]}')
            .mockResolvedValue('{"unsupported":[]}');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.judge).toHaveBeenCalledTimes(6); // one call per piece
        expect(state.inserts).toHaveLength(0);
        const fault = state.updates.at(-1) as { status: string; error_message: string };
        expect(fault.status).toBe('draft');
        expect(fault.error_message).toContain('Unsupported claim');
        expect(fault.error_message).toContain('short_1');
    });

    it('rejects a sourced draft when the claim check gives no verdict', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        gen();
        state.judge.mockResolvedValue('Looks fine');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.inserts).toHaveLength(0);
    });

    it('inserts a sourced draft every piece of which the judge finds clean', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        gen();
        state.judge.mockResolvedValue('{"unsupported":[]}');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.judge).toHaveBeenCalledTimes(6);
        expect(state.inserts).toHaveLength(1);
    });

    it('rejects a sourced draft that quotes words no source holds, and says why on the retry', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        const passage = 'now I am sick and tired of being sick and tired, and we want a change.';
        state.topic = { historical_points: [{ claim: passage, quote: passage, source: 'Speech', year: '1964' }] };
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: pieceType === 'long' ? "Her words: 'I'm sick and tired of being sick and tired.'" : 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.inserts).toHaveLength(0);
        const fault = state.updates.at(-1) as { status: string; error_message: string };
        expect(fault.status).toBe('draft');
        expect(fault.error_message).toContain('Unsourced quotation');
        state.updates.length = 0;
        state.topic = { ...state.topic, retry_count: 1, error_message: fault.error_message };
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate.mock.calls.at(-1)?.[0].user).toContain('A PREVIOUS DRAFT WAS REJECTED');
    });
    // 2026-10-25 (fix 5.3): a draft failed only by the number check came back with the same prompt.
    it('puts a number-check reason into the retry prompt, not only quote faults', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        const pieces = sourcedPieces().map(p => ({ ...p, captionShort: p.pieceType === 'long' ? 'James spied for Lafayette in 1799' : 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        const fault = state.updates.at(-1) as { status: string; error_message: string };
        expect(fault.error_message).toContain('Unsupported claim');
        expect(fault.error_message).not.toContain('Unsourced quotation');
        expect(state.judge).not.toHaveBeenCalled();
        state.updates.length = 0;
        state.topic = { ...state.topic, retry_count: 1, error_message: fault.error_message };
        await GET(new Request('https://fixture/api/cron/content-generator'));
        const retryPrompt = state.generate.mock.calls.at(-1)?.[0].user as string;
        expect(retryPrompt).toContain('A PREVIOUS DRAFT WAS REJECTED');
        expect(retryPrompt).toContain('long captionShort states "1799", which no source passage holds');
    });
    it('records both the quote and the number reason when a draft fails both, and retries with both', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint] };
        const pieces = sourcedPieces().map(p => ({ ...p, captionShort: p.pieceType === 'long' ? 'In 1799 he said "I was a double agent."' : 'caption' }));
        state.generate.mockResolvedValue({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        const fault = state.updates.at(-1) as { error_message: string };
        expect(fault.error_message).toContain('Unsourced quotation');
        expect(fault.error_message).toContain('"1799"');
        state.topic = { ...state.topic, retry_count: 1, error_message: fault.error_message };
        await GET(new Request('https://fixture/api/cron/content-generator'));
        const retryPrompt = state.generate.mock.calls.at(-1)?.[0].user as string;
        expect(retryPrompt).toContain('Unsourced quotation');
        expect(retryPrompt).toContain('"1799", which no source passage holds');
        expect(retryPrompt.match(/A PREVIOUS DRAFT WAS REJECTED/g)).toHaveLength(1);
    });
    it('puts a judge reason into the retry prompt', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        state.topic = { historical_points: [lafayettePoint], retry_count: 1, error_message: 'Content-generator: Unsupported claim: short_1: double agent for the British (he only pretended)' };
        gen();
        state.judge.mockResolvedValue('{"unsupported":[]}');
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate.mock.calls[0][0].user).toContain('A PREVIOUS DRAFT WAS REJECTED. Unsupported claim: short_1: double agent for the British');
    });
    it('keeps the quote fault through the local queue wait, then unquotes the consumed Hamer caption', async () => {
        vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'ollama');
        const passage = 'now I am sick and tired of being sick and tired, and we want a change.';
        state.topic = { historical_points: [{ claim: passage, quote: passage, source: 'Speech', year: '1964' }], retry_count: 1, error_message: "Content-generator: Unsourced quotation: \"I'm sick and tired of being sick and tired.\"" };
        state.generate.mockRejectedValueOnce(new LocalInferencePendingError('fixture'));
        await GET(new Request('https://fixture/api/cron/content-generator'));
        const queuedPrompt = state.generate.mock.calls[0][0].user;
        expect(queuedPrompt).toContain('A PREVIOUS DRAFT WAS REJECTED');
        expect(state.updates).toEqual([{ status: 'draft' }]);
        expect(state.updates[0]).not.toHaveProperty('error_message');
        // Next pass: the topic row still carries the fault, so the prompt (the job key) matches.
        state.updates.length = 0;
        const pieces = ['long', 'short_1', 'short_2', 'short_3', 'short_4', 'carousel'].map(pieceType => ({ pieceType, script: 'source draft', captionLong: 'caption', captionShort: pieceType === 'long' ? `Her words: "I'm sick and tired of being sick and tired."` : 'caption' }));
        state.generate.mockResolvedValueOnce({ text: JSON.stringify({ pieces }), inputTokens: 5, outputTokens: 20, provider: 'ollama' });
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate.mock.calls[1][0].user).toBe(queuedPrompt);
        expect(state.inserts).toHaveLength(1);
        const long = (state.inserts[0] as Array<{ piece_type: string; caption_short: string }>).find(r => r.piece_type === 'long');
        expect(long?.caption_short).not.toContain('"');
        expect(long?.caption_short).toContain("I'm sick and tired of being sick and tired.");
        expect(state.updates.at(-1)).toMatchObject({ status: 'content_ready' });
    });
    it('recovers existing pieces to review without generating or autoapproving', async () => {
        state.existing = 6;
        await GET(new Request('https://fixture/api/cron/content-generator'));
        expect(state.generate).not.toHaveBeenCalled();
        expect(state.updates[0]).toMatchObject({ status: 'content_ready', requires_review: true, coo_auto_approved_at: null });
    });

    // 2026-10-22: a hosted draft is held while the claim judge works, then released.
    describe('draft holds', () => {
        const passPieces = () => sourcedPieces().map(p => ({ ...p, captionShort: 'caption' }));
        it('asks for a held draft, and keeps it while the judge has not answered', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockRejectedValue(Object.assign(new LocalInferencePendingError('judge'), { name: 'LocalInferencePendingError' }));
            const body = await (await GET(new Request('https://fixture/api/cron/content-generator'))).json();
            expect(state.generate.mock.calls[0][0]).toMatchObject({ holdForTopic: 'fixture' });
            expect(body.results[0].queued).toBe(true);
            expect(state.release).not.toHaveBeenCalled();
            expect(state.inserts).toHaveLength(0);
        });
        it('releases the held draft when the attempt passes', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.inserts).toHaveLength(1);
            expect(state.release).toHaveBeenCalledWith('fixture');
        });
        it('releases the held draft when the attempt fails, so the retry gets a new one', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[{"claim":"x","reason":"y"}]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.inserts).toHaveLength(0);
            expect(state.release).toHaveBeenCalledWith('fixture');
            expect(state.updates.at(-1)).toMatchObject({ status: 'draft', retry_count: 1 });
        });
        it('guards every result write on the drain statuses, so a held topic is not flipped back to draft (2026-10-25)', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[{"claim":"x","reason":"y"}]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.guards).toContainEqual(['status', ['draft', 'content_generating']]);
            state.guards.length = 0;
            state.judge.mockResolvedValue('{"unsupported":[]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.updates.at(-1)).toMatchObject({ status: 'content_ready' });
            expect(state.guards).toContainEqual(['status', ['draft', 'content_generating']]);
        });
        // 2026-10-26 (qcheck 5.4 F1, F2, F3 and 5.2 Q5): a held topic stays held at every write.
        it('does not claim a topic that was held after the select, and writes nothing else', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.heldOn = 'content_generating';
            const response = await GET(new Request('https://fixture/api/cron/content-generator'));
            expect((await response.json()).results[0].skipped).toBe('topic left the drain');
            expect(state.generate).not.toHaveBeenCalled();
            expect(state.inserts).toHaveLength(0);
            expect(state.updates).toEqual([{ status: 'content_generating' }]);
        });
        it('removes the pieces and reports a skip when the topic was held during the run', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[]}');
            state.heldOn = 'content_ready';
            const response = await GET(new Request('https://fixture/api/cron/content-generator'));
            const result = (await response.json()).results[0];
            expect(result.skipped).toBe('topic left the drain during the run');
            expect(result.piecesInserted).toBe(0);
            expect(state.deletes).toEqual(['content_pieces']);
            // Codex C2 (2026-10-27): only the ids this run inserted, not every pending piece of the topic.
            expect(state.guards).toContainEqual(['id', ['piece-0', 'piece-1', 'piece-2', 'piece-3', 'piece-4', 'piece-5']]);
            expect(state.release).toHaveBeenCalledWith('fixture');
            expect(state.updates.some(u => u.status === 'draft')).toBe(false);
        });
        // 2026-10-27 (qcheck R2, Codex C3)
        it('does not page or write the held_for_review trail when an exhausted retry finds the topic gone from the drain', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { historical_points: [lafayettePoint], retry_count: 2 };
            state.generate.mockResolvedValue({ text: JSON.stringify({ pieces: passPieces() }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[{"claim":"x","reason":"y"}]}');
            const { notifyError } = await import('@/lib/notifications');
            state.heldOn = 'draft';
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.updates.at(-1)).toMatchObject({ status: 'draft', retry_count: 3, requires_review: true });
            expect(state.trails.some(t => ['escalated', 'state_changed'].includes((t as { stage: string }).stage))).toBe(false);
            expect(notifyError).not.toHaveBeenCalled();
            // Control: the same exhausted failure with the topic still in the drain pages and writes the trail.
            state.heldOn = null;
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.trails.map(t => (t as { stage: string }).stage)).toEqual(expect.arrayContaining(['state_changed', 'escalated']));
            expect(notifyError).toHaveBeenCalledTimes(1);
        });
        it('guards the recovery write too, and keeps the hold when that write changes nothing', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.existing = 3;
            state.heldOn = 'content_ready';
            const response = await GET(new Request('https://fixture/api/cron/content-generator'));
            expect((await response.json()).results[0].skipped).toBe('topic left the drain');
            expect(state.guards).toContainEqual(['status', ['draft', 'content_generating']]);
            expect(state.release).not.toHaveBeenCalled();
        });
        it('holds the quote video captions draft too', async () => {
            vi.stubEnv('CONTENT_INFERENCE_PROVIDER', 'claude');
            state.topic = { title: 'Figure: Words', personas: { name: 'Fixture', content_format: 'quote_video' }, historical_points: [{ ...lafayettePoint, claim: 'Words spoken here.' }] };
            state.generate.mockResolvedValue({ text: JSON.stringify({ captionLong: 'caption', captionShort: 'caption' }), inputTokens: 5, outputTokens: 20, provider: 'claude' });
            state.judge.mockResolvedValue('{"unsupported":[]}');
            await GET(new Request('https://fixture/api/cron/content-generator'));
            expect(state.generate.mock.calls[0][0]).toMatchObject({ holdForTopic: 'fixture' });
        });
    });
});
