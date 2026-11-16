import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportDateFor, buildReportSubject, sendCooPublishReport } from './coo-report';

function fakeSupabase(rows: Record<string, unknown>[]) {
    const eqCalls: Array<[string, string]> = [];
    const costBounds: string[] = [];
    const from = (table: string) => {
        if (table === 'publish_reports') {
            const q = {
                select: () => q,
                eq: (col: string, val: string) => { eqCalls.push([col, val]); return q; },
                order: () => Promise.resolve({ data: rows, error: null }),
            };
            return q;
        }
        const c = {
            select: () => c,
            gte: (_col: string, v: string) => { costBounds.push(v); return c; },
            lt: (_col: string, v: string) => { costBounds.push(v); return Promise.resolve({ data: [{ cost_usd: 0.09 }], error: null }); },
        };
        return c;
    };
    return { supabase: { from } as never, eqCalls, costBounds };
}

describe('coo-report prior UTC day', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('reportDateFor returns the day before the run, across a month edge', () => {
        expect(reportDateFor(new Date('2026-11-02T10:00:00Z'))).toBe('2026-11-01');
        expect(reportDateFor(new Date('2026-12-01T10:00:00Z'))).toBe('2026-11-30');
    });

    it('subject names the scope and the count', () => {
        const s = buildReportSubject('2026-11-01', { total: 2, published: 1, failed: 1, reviewNeeded: 0 });
        expect(s).toContain('1 published, 1 failed');
        expect(s).toContain('fh-content app only, UTC');
        expect(s).toContain('Part 107, NE Corner and music');
        expect(buildReportSubject('2026-11-01', { total: 0, published: 0, failed: 0, reviewNeeded: 0 })).toContain('No content published');
    });

    it('queries the prior UTC date for rows and cost, and sends the matching count', async () => {
        vi.stubEnv('RESEND_API_KEY', 'test-key');
        vi.stubEnv('NOTIFICATION_EMAIL', 'to@example.test');
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
        vi.stubGlobal('fetch', fetchMock);
        const rows = [{ persona_id: 'p', topic_title: 'T', platforms_published: ['x'], platforms_failed: [], required_review: false, personas: { name: 'FV' } }];
        const { supabase, eqCalls, costBounds } = fakeSupabase(rows);

        const ok = await sendCooPublishReport(supabase, new Date('2026-11-02T10:00:00Z'));

        expect(ok).toBe(true);
        expect(eqCalls).toEqual([['report_date', '2026-11-01']]);
        expect(costBounds).toEqual(['2026-11-01T00:00:00Z', '2026-11-02T00:00:00.000Z']);
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.subject).toContain('2026-11-01 — 1 published, 0 failed');
        expect(body.subject).toContain('fh-content app only, UTC');
        vi.unstubAllGlobals();
    });
});
