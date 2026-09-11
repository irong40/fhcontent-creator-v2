import { describe, expect, it, vi } from 'vitest';
import { generateLocalDraft } from './local-content-draft';

const packet = { kind: 'captions', sourceId: 'test-source', reviewedBy: 'operator', source: 'The site was photographed on September 11.', instructions: 'Plain language.' };
const answer = { title: 'Site photographs', body: 'The site was photographed on September 11.', sourceIds: ['test-source'] };
const response = (content = JSON.stringify(answer), extra = {}) => new Response(JSON.stringify({ message: { content }, done: true, done_reason: 'stop', model: 'qwen3:8b', ...extra }));

describe('supervised local content drafts', () => {
    it('rejects a missing source review before inference', async () => {
        const call = vi.fn();
        await expect(generateLocalDraft({ ...packet, reviewedBy: '' }, call)).rejects.toThrow();
        expect(call).not.toHaveBeenCalled();
    });
    it('calls only loopback with schema and preserves review hold and provenance', async () => {
        const call = vi.fn().mockResolvedValue(response());
        const result = await generateLocalDraft(packet, call);
        expect(call.mock.calls[0][0]).toBe('http://127.0.0.1:11434/api/chat');
        const request = JSON.parse(call.mock.calls[0][1].body);
        expect(request.think).toBe(false);
        expect(request.format.required).toContain('sourceIds');
        expect(result.status).toBe('needs_review');
        expect(result.provenance.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.draft).toEqual(answer);
        expect(result.provider).toBe('ollama');
    });
    it.each([
        ['empty', response('')],
        ['malformed', response('{broken')],
        ['missing fields', response('{}')],
        ['truncated', response(JSON.stringify(answer), { done_reason: 'length' })],
        ['unfinished', response(JSON.stringify(answer), { done: false })],
        ['wrong source', response(JSON.stringify({ ...answer, sourceIds: ['invented'] }))],
        ['invented number', response(JSON.stringify({ ...answer, body: 'There are 900 defects.' }))],
        ['wrong model', response(JSON.stringify(answer), { model: 'unexpected:cloud' })],
        ['too long', response(JSON.stringify({ ...answer, body: Array(101).fill('photographs').join(' ') }))],
    ])('rejects %s output', async (_name, res) => {
        await expect(generateLocalDraft(packet, vi.fn().mockResolvedValue(res))).rejects.toThrow();
    });
    it('fails once without hosted fallback', async () => {
        const call = vi.fn().mockRejectedValue(new Error('local unavailable'));
        await expect(generateLocalDraft(packet, call)).rejects.toThrow('local unavailable');
        expect(call).toHaveBeenCalledTimes(1);
    });
});
