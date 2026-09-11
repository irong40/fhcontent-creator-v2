import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { contentResponseSchema } from './schemas';
import { getOrEnqueueLocalInference, LocalInferencePendingError } from './local-inference-queue';
const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock('./supabase/server', () => ({ createAdminClient: admin }));
const request = { requestKey: 'caption:123', system: 'Transform source', user: 'Verified source', maxTokens: 100 };
function database(status = 'queued', overrides = {}, insertError: unknown = null) {
    const upsert = vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ error: insertError }) });
    const eq = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'job', status, result_text: 'Draft', input_tokens: 10, output_tokens: 5, ...overrides }, error: null }) });
    admin.mockReturnValue({ from: vi.fn().mockReturnValue({ upsert, select: vi.fn().mockReturnValue({ eq }) }) });
    return { upsert, eq };
}
describe('local inference durable queue', () => {
    beforeEach(() => vi.clearAllMocks());
    it.each(['queued', 'running'])('surfaces %s as typed pending', async status => {
        const { upsert } = database(status);
        await expect(getOrEnqueueLocalInference(request)).rejects.toBeInstanceOf(LocalInferencePendingError);
        expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'request_key', ignoreDuplicates: true });
        expect(upsert.mock.calls[0][0]).not.toHaveProperty('status');
    });
    it('returns existing completed text and actual usage', async () => {
        database('succeeded');
        await expect(getOrEnqueueLocalInference(request)).resolves.toEqual({ text: 'Draft', inputTokens: 10, outputTokens: 5 });
    });
    it('transports actual generated content JSON Schema without runtime adapters', async () => {
        const { upsert } = database('succeeded');
        const schema = z.toJSONSchema(contentResponseSchema);
        await getOrEnqueueLocalInference({ ...request, schema });
        expect(upsert.mock.calls[0][0].response_schema).not.toHaveProperty('~standard');
        expect(upsert.mock.calls[0][0].response_schema).toEqual(JSON.parse(JSON.stringify(schema)));
    });
    it('never requeues terminal failure', async () => {
        database('failed');
        await expect(getOrEnqueueLocalInference(request)).rejects.toThrow('exhausted');
    });
    it.each([{ result_text: '' }, { input_tokens: null }, { output_tokens: -1 }])('rejects corrupt completion %j', async overrides => {
        database('succeeded', overrides);
        await expect(getOrEnqueueLocalInference(request)).rejects.toThrow('Invalid local');
    });
    it('hashes all effective inputs and normalizes schema key order', async () => {
        const { upsert } = database('succeeded');
        await getOrEnqueueLocalInference({ ...request, schema: { type: 'object', properties: {} } });
        await getOrEnqueueLocalInference({ ...request, schema: { properties: {}, type: 'object' } });
        await getOrEnqueueLocalInference({ ...request, user: 'Changed source', schema: { type: 'object', properties: {} } });
        expect(upsert.mock.calls[0][0].request_key).toBe(upsert.mock.calls[1][0].request_key);
        expect(upsert.mock.calls[0][0].request_key).not.toBe(upsert.mock.calls[2][0].request_key);
    });
    it('stops on database error without reading or falling back', async () => {
        const { eq } = database('queued', {}, { code: '42501' });
        await expect(getOrEnqueueLocalInference(request)).rejects.toThrow('42501');
        expect(eq).not.toHaveBeenCalled();
    });
    it('rejects invalid request before database access', async () => {
        await expect(getOrEnqueueLocalInference({ ...request, maxTokens: -1 })).rejects.toThrow();
        await expect(getOrEnqueueLocalInference({ ...request, schema: { invalid: new Date() } })).rejects.toThrow();
        await expect(getOrEnqueueLocalInference({ ...request, user: 'x'.repeat(24000) })).rejects.toThrow('context budget');
        await expect(getOrEnqueueLocalInference({ ...request, user: '\u4e00'.repeat(9000) })).rejects.toThrow('context budget');
        expect(admin).not.toHaveBeenCalled();
    });
    it('reserves requested output and framing within the model context', async () => {
        database('succeeded');
        await expect(getOrEnqueueLocalInference({ ...request, system: 'x', user: 'x'.repeat(7679), maxTokens: 8192 })).resolves.toHaveProperty('text');
        admin.mockClear();
        await expect(getOrEnqueueLocalInference({ ...request, system: 'x', user: 'x'.repeat(7680), maxTokens: 8192 })).rejects.toThrow('16384-token');
        await expect(getOrEnqueueLocalInference({ ...request, system: 'x', user: 'x'.repeat(8999), maxTokens: 8192 })).rejects.toThrow('16384-token');
        expect(admin).not.toHaveBeenCalled();
    });
});
