import { describe, expect, it, vi, afterEach } from 'vitest';
import { callJudge, claimJudgeConfig, claimJudgePrompt, judgeClaims, hasSourcePassages, parseClaimVerdict, unsupportedSpecifics } from './claim-check';

// The 2026-10-18 Lafayette point and the pieces that contradicted it.
const lafayette = [{
    claim: 'James was a double agent who pretended to spy on the American army on behalf of the British but repeated to Lafayette the conversations he overheard.',
    quote: 'James was a double agent who pretended to spy on the American army on behalf of the British but repeated to Lafayette the conversations he overheard waiting tables at the headquarters of General Charles Cornwallis in Yorktown.',
}, { claim: 'He was freed by act in 1786.', quote: 'the House of Delegates passed an act freeing him from slavery on 25 December 1786' }];
const bad = [{ pieceType: 'short_1', script: 'James Lafayette was a double agent for the British in 1781.', captionShort: 'Freed in 1786.' }];

describe('unsupportedSpecifics', () => {
    it('flags a year or number no passage holds', () => {
        expect(unsupportedSpecifics(lafayette, bad)).toEqual(['short_1 script states "1781", which no source passage holds']);
    });
    it('reads carousel slides', () => {
        expect(unsupportedSpecifics(lafayette, [{ pieceType: 'carousel', carouselSlides: [{ text: 'In 1799 he left.' }] }])).toHaveLength(1);
    });
    it('does not check a topic with no source passages', () => {
        expect(unsupportedSpecifics([{ claim: 'x', quote: null }], bad)).toEqual([]);
        expect(hasSourcePassages([{ claim: 'x', quote: null }])).toBe(false);
    });
});

describe('claim judge', () => {
    it('puts every passage and every text field in the prompt, and bars outside knowledge', () => {
        const p = claimJudgePrompt(lafayette, bad);
        expect(p.user).toContain('[1] James was a double agent who pretended');
        expect(p.user).toContain('(short_1 script) James Lafayette was a double agent for the British');
        expect(p.system).toContain('Never use outside knowledge');
    });
    it('turns a verdict into faults', () => {
        expect(parseClaimVerdict('```json\n{"unsupported":[{"claim":"double agent for the British","reason":"he only pretended"}]}\n```'))
            .toEqual(['"double agent for the British" - he only pretended']);
        expect(parseClaimVerdict('{"unsupported":[]}')).toEqual([]);
    });
    it('fails closed when the reply is not a verdict', () => {
        expect(() => parseClaimVerdict('Looks fine to me')).toThrow('Unsupported claim');
        expect(() => parseClaimVerdict(JSON.stringify({ pieces: [] }))).toThrow('no verdict');
    });
});

describe('judgeClaims', () => {
    const pieces = [
        { pieceType: 'long', script: 'He pretended to spy and told Lafayette what he heard.' },
        { pieceType: 'short_1', script: 'James was a double agent for the British.' },
    ];
    it('sends the judge one piece at a time, each with all numbered passages', async () => {
        const call = vi.fn(async (_system: string, _user: string) => '{"unsupported":[]}');
        expect(await judgeClaims(lafayette, pieces, call)).toEqual([]);
        expect(call).toHaveBeenCalledTimes(2);
        const [first, second] = call.mock.calls.map(c => c[1] as string);
        expect(first).toContain('(long script)');
        expect(first).not.toContain('short_1');
        expect(second).toContain('(short_1 script)');
        expect(second).not.toContain('(long script)');
        for (const user of [first, second]) { expect(user).toContain('[1] '); expect(user).toContain('[4] '); }
    });
    it('fails the topic when any one piece fails, naming the piece', async () => {
        const call = vi.fn()
            .mockResolvedValueOnce('{"unsupported":[]}')
            .mockResolvedValueOnce('{"unsupported":[{"claim":"double agent for the British","reason":"he only pretended"}]}');
        expect(await judgeClaims(lafayette, pieces, call)).toEqual(['short_1: "double agent for the British" - he only pretended']);
    });
    it('fails closed when any piece gets no verdict', async () => {
        const call = vi.fn().mockResolvedValueOnce('{"unsupported":[]}').mockResolvedValueOnce('fine');
        await expect(judgeClaims(lafayette, pieces, call)).rejects.toThrow('no verdict');
    });
});

describe('judge model settings', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('defaults to qwen3:32b on 127.0.0.1, not localhost', () => {
        expect(claimJudgeConfig({})).toEqual({ model: 'qwen3:32b', endpoint: 'http://127.0.0.1:11434' });
    });
    it('takes the model and endpoint from env', () => {
        expect(claimJudgeConfig({ CLAIM_JUDGE_MODEL: 'qwen3:14b', CLAIM_JUDGE_ENDPOINT: 'http://10.0.0.5:11434/' }))
            .toEqual({ model: 'qwen3:14b', endpoint: 'http://10.0.0.5:11434' });
    });
    const stream = (lines: string[]) => new Response(new ReadableStream({ start(c) { lines.forEach(l => c.enqueue(new TextEncoder().encode(l))); c.close(); } }));
    it('streams the reply and joins the chunks, even when a line is split across reads', async () => {
        const fetchMock = vi.fn(async () => stream([
            '{"message":{"content":"{\\"unsupp"},"done":false}\n{"mess',
            'age":{"content":"orted\\":[]}"},"done":false}\n{"message":{"content":""},"done":true}\n',
        ]));
        vi.stubGlobal('fetch', fetchMock);
        expect(await callJudge('sys', 'user', { CLAIM_JUDGE_MODEL: 'm' })).toBe('{"unsupported":[]}');
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
        expect(url).toBe('http://127.0.0.1:11434/api/chat');
        expect(JSON.parse(init.body)).toMatchObject({ model: 'm', stream: true });
    });
    it('rejects a stream that ends before the model is done', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => stream(['{"message":{"content":"{"},"done":false}\n'])));
        await expect(callJudge('s', 'u', {})).rejects.toThrow('ended before');
    });
    it('rejects an HTTP failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
        await expect(callJudge('s', 'u', {})).rejects.toThrow('HTTP 500');
    });
});
