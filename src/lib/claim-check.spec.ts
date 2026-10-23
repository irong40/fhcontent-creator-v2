import { describe, expect, it, vi, afterEach } from 'vitest';
import { callJudgeDirect, claimJudgeConfig, claimJudgePrompt, judgeClaims, hasSourcePassages, parseClaimVerdict, unsupportedSpecifics, wordNumbers } from './claim-check';

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

// 2026-10-22: eight Sonnet rewrites hit retry 3 on numbers the topic does hold. The points
// below are trimmed from the real topics (Supabase qjpujskwqaehxnqypxzu, 2026-10-22).
describe('unsupportedSpecifics reads the whole topic (2026-10-22)', () => {
    const worldHouse = [{
        year: '1967',
        claim: 'The large house in which we live demands that we transform this worldwide neighborhood into a worldwide brotherhood.',
        quote: 'The large house in which we live demands that we transform this worldwide neighborhood into a worldwide brotherhood.',
        source: 'Martin Luther King, The World House, from Where Do We Go From Here: Chaos or Community? (1967), Civil Rights Movement Archive',
    }];
    const carter = [
        { year: '1852', claim: 'Willis McGlascoe Carter was born into slavery in Albemarle County in 1852.', quote: 'Willis McGlascoe Carter (3 September 1852–23 March 1902), educator and editor, was born into slavery in Albemarle County.', source: 'Dictionary of Virginia Biography, Library of Virginia' },
        { year: '1881', claim: 'He taught at the Smoky Row School in Staunton starting with the 1881–1882 term.', quote: 'He taught in the Smoky Row School in Staunton for the 1881–1882 and 1882–1883 terms and was then appointed principal of the West End School where he remained for approximately fifteen years.', source: 'Dictionary of Virginia Biography, Library of Virginia' },
        { year: '1891', claim: 'Carter edited the Southern Tribune, founded in Staunton in April 1891.', quote: 'a weekly African American newspaper founded in Staunton in April 1891.', source: 'Dictionary of Virginia Biography, Library of Virginia' },
    ];
    const piece = (text: string, pieceType = 'short_1') => [{ pieceType, script: text }];

    it('allows a year from the source line (the quote video credit line, World House)', () => {
        // The on-screen script is built in code: quote, then "— figure, source, year".
        const script = `${worldHouse[0].claim}\n\n— Martin Luther King, ${worldHouse[0].source}, ${worldHouse[0].year}`;
        expect(unsupportedSpecifics(worldHouse, [{ pieceType: 'quote_video', script, captionLong: 'King wrote this in 1967.' }])).toEqual([]);
        // The source line alone is enough: no claim, quote or year field holds 1967 here.
        const sourceOnly = [{ ...worldHouse[0], year: undefined }];
        expect(unsupportedSpecifics(sourceOnly, piece('Published in 1967.'))).toEqual([]);
    });

    it('allows a year from another point\'s passage', () => {
        // A short about point 1 may name the year point 3 gives.
        expect(unsupportedSpecifics(carter, piece('Born in 1852, he would edit a newspaper by 1891.'))).toEqual([]);
    });

    it('rejects a number found nowhere in the topic', () => {
        expect(unsupportedSpecifics(carter, piece('He founded the paper in 1890 with 40 partners.')))
            .toEqual(['short_1 script states "1890", which no source passage holds', 'short_1 script states "40", which no source passage holds']);
        // Alexander's paper was founded in February 1941. "1940" is wrong, not a style choice.
        const alexander = [{ year: '1941', claim: 'In February 1941 he founded the Roanoke Tribune.', quote: 'In February 1941 Alexander founded the Roanoke Tribune , a weekly newspaper.', source: 'Dictionary of Virginia Biography, Library of Virginia' }];
        expect(unsupportedSpecifics(alexander, [{ pieceType: 'carousel', carouselSlides: [{ text: 'In 1940 he founded the Tribune.' }] }]))
            .toEqual(['carousel carouselSlides[0] states "1940", which no source passage holds']);
    });

    it('allows a number the passage writes in words (Clara Byrd Baker, "eighty-seven", "Nineteenth")', () => {
        const baker = [
            { year: '1989', claim: 'In September 1989 the school opened near where she had begun teaching eighty-seven years earlier.', quote: 'near the site where she had begun her teaching career eighty-seven years earlier.', source: 'Dictionary of Virginia Biography, Library of Virginia' },
            { year: '1920', claim: 'She was one of the first women to register after the Nineteenth Amendment was ratified in 1920.', quote: 'after the ratification of the Nineteenth Amendment in 1920', source: 'Dictionary of Virginia Biography, Library of Virginia' },
        ];
        expect(unsupportedSpecifics(baker, piece('87 years later, a school bore her name. She voted under the 19th Amendment.'))).toEqual([]);
        expect(unsupportedSpecifics(baker, piece('88 years later'))).toEqual(['short_1 script states "88", which no source passage holds']);
    });

    it('allows a decade, century or year range the topic\'s years fall in, and rejects one they do not', () => {
        expect(unsupportedSpecifics(carter, piece('In the 1880s he taught in Staunton, in the late 19th century, through the 1881–82 term.'))).toEqual([]);
        // Carter died in 1902 (point 1's passage), so the 20th century is held too.
        expect(unsupportedSpecifics(carter, piece('He lived into the 20th century.'))).toEqual([]);
        expect(unsupportedSpecifics(carter, piece('By the 1950s, and back in the 18th century, through 1881–85.'))).toEqual([
            'short_1 script states "1950s", which no source passage holds',
            'short_1 script states "18th century", which no source passage holds',
            'short_1 script states "85", which no source passage holds',
        ]);
    });

    it('allows a year in the topic title', () => {
        const point = [{ claim: 'She spoke in Harlem.', quote: 'She spoke in Harlem.', source: 'Speech archive' }];
        expect(unsupportedSpecifics(point, piece('Her 1964 speech.'), { title: 'Fannie Lou Hamer: The 1964 Harlem Speech' })).toEqual([]);
        expect(unsupportedSpecifics(point, piece('Her 1964 speech.'))).toHaveLength(1);
    });

    it('treats 5,000 and 5000 as the same number', () => {
        const point = [{ claim: 'He interviewed 5,000 people.', quote: 'Dr. Du Bois personally visited and interviewed 5,000 people.' }];
        expect(unsupportedSpecifics(point, piece('He interviewed 5000 people.'))).toEqual([]);
    });
});

describe('wordNumbers', () => {
    it('reads numbers written in words', () => {
        expect(wordNumbers('eighty-seven years earlier')).toEqual(['87']);
        expect(wordNumbers('the Nineteenth Amendment')).toEqual(['19']);
        expect(wordNumbers('the one hundredth anniversary')).toEqual(['100']);
        expect(wordNumbers('perhaps three billion a year for a five-year period')).toEqual(['3000000000', '3', '5']);
        expect(wordNumbers('one hundred and fifty delegates')).toEqual(['150']);
        expect(wordNumbers('in two thousand twenty')).toEqual(['2020', '2']);
        expect(wordNumbers('one two')).toEqual(['1', '2']);
        expect(wordNumbers('no numbers here')).toEqual([]);
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
        expect(await callJudgeDirect('sys', 'user', { CLAIM_JUDGE_MODEL: 'm' })).toBe('{"unsupported":[]}');
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
        expect(url).toBe('http://127.0.0.1:11434/api/chat');
        expect(JSON.parse(init.body)).toMatchObject({ model: 'm', stream: true });
    });
    it('rejects a stream that ends before the model is done', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => stream(['{"message":{"content":"{"},"done":false}\n'])));
        await expect(callJudgeDirect('s', 'u', {})).rejects.toThrow('ended before');
    });
    it('rejects an HTTP failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
        await expect(callJudgeDirect('s', 'u', {})).rejects.toThrow('HTTP 500');
    });
});
