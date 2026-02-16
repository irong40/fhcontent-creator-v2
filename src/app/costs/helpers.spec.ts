import { describe, it, expect } from 'vitest';
import {
    filterByDateRange,
    aggregateByService,
    aggregateByDate,
    buildPersonaCosts,
    type CostRow,
    type CostEntry,
} from './helpers';

describe('filterByDateRange', () => {
    const rows: CostRow[] = [
        { date: new Date().toISOString().split('T')[0], service: 'openai', operations: 1, total_cost: 0.05 },
        { date: new Date(Date.now() - 5 * 86400000).toISOString().split('T')[0], service: 'claude', operations: 2, total_cost: 0.10 },
        { date: new Date(Date.now() - 15 * 86400000).toISOString().split('T')[0], service: 'heygen', operations: 1, total_cost: 1.00 },
        { date: new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0], service: 'elevenlabs', operations: 3, total_cost: 0.30 },
    ];

    it('returns all rows for "all" range', () => {
        expect(filterByDateRange(rows, 'all')).toHaveLength(4);
    });

    it('returns only last 7 days for "7d" range', () => {
        const result = filterByDateRange(rows, '7d');
        expect(result).toHaveLength(2);
        expect(result.map(r => r.service)).toEqual(['openai', 'claude']);
    });

    it('returns last 30 days for "30d" range', () => {
        const result = filterByDateRange(rows, '30d');
        expect(result).toHaveLength(3);
    });

    it('includes rows with null date in filtered results', () => {
        const withNull: CostRow[] = [
            ...rows,
            { date: null, service: 'unknown', operations: 0, total_cost: 0 },
        ];
        const result = filterByDateRange(withNull, '7d');
        expect(result.some(r => r.date === null)).toBe(true);
    });

    it('returns empty array when no rows match', () => {
        const old: CostRow[] = [
            { date: '2020-01-01', service: 'old', operations: 1, total_cost: 1 },
        ];
        expect(filterByDateRange(old, '7d')).toHaveLength(0);
    });
});

describe('aggregateByService', () => {
    it('groups costs by service name', () => {
        const rows: CostRow[] = [
            { date: '2025-01-01', service: 'openai', operations: 2, total_cost: 0.10 },
            { date: '2025-01-02', service: 'openai', operations: 3, total_cost: 0.15 },
            { date: '2025-01-01', service: 'claude', operations: 1, total_cost: 0.05 },
        ];
        const { byService, grandTotal } = aggregateByService(rows);
        expect(byService['openai'].operations).toBe(5);
        expect(byService['openai'].cost).toBeCloseTo(0.25);
        expect(byService['claude'].operations).toBe(1);
        expect(grandTotal).toBeCloseTo(0.30);
    });

    it('maps null service to "unknown"', () => {
        const rows: CostRow[] = [
            { date: '2025-01-01', service: null, operations: 1, total_cost: 0.50 },
        ];
        const { byService } = aggregateByService(rows);
        expect(byService['unknown'].cost).toBeCloseTo(0.50);
    });

    it('handles null total_cost as 0 (not NaN)', () => {
        const rows: CostRow[] = [
            { date: '2025-01-01', service: 'openai', operations: 1, total_cost: null },
            { date: '2025-01-02', service: 'openai', operations: 2, total_cost: 0.10 },
        ];
        const { byService, grandTotal } = aggregateByService(rows);
        expect(Number.isNaN(byService['openai'].cost)).toBe(false);
        expect(byService['openai'].cost).toBeCloseTo(0.10);
        expect(Number.isNaN(grandTotal)).toBe(false);
        expect(grandTotal).toBeCloseTo(0.10);
    });

    it('handles undefined total_cost as 0 (not NaN)', () => {
        const rows: CostRow[] = [
            { date: '2025-01-01', service: 'x', operations: 1, total_cost: undefined as unknown as null },
        ];
        const { grandTotal } = aggregateByService(rows);
        expect(Number.isNaN(grandTotal)).toBe(false);
        expect(grandTotal).toBe(0);
    });

    it('returns empty result for empty input', () => {
        const { byService, grandTotal } = aggregateByService([]);
        expect(Object.keys(byService)).toHaveLength(0);
        expect(grandTotal).toBe(0);
    });
});

describe('aggregateByDate', () => {
    it('groups and sums costs by date', () => {
        const rows: CostRow[] = [
            { date: '2025-01-01', service: 'a', operations: 1, total_cost: 0.10 },
            { date: '2025-01-01', service: 'b', operations: 1, total_cost: 0.20 },
            { date: '2025-01-02', service: 'a', operations: 1, total_cost: 0.05 },
        ];
        const { byDate, sortedDates } = aggregateByDate(rows);
        expect(byDate['2025-01-01']).toBeCloseTo(0.30);
        expect(byDate['2025-01-02']).toBeCloseTo(0.05);
        expect(sortedDates).toEqual(['2025-01-02', '2025-01-01']);
    });

    it('skips rows with null date', () => {
        const rows: CostRow[] = [
            { date: null, service: 'a', operations: 1, total_cost: 0.50 },
            { date: '2025-01-01', service: 'a', operations: 1, total_cost: 0.10 },
        ];
        const { byDate } = aggregateByDate(rows);
        expect(Object.keys(byDate)).toHaveLength(1);
    });

    it('handles null total_cost as 0 (not NaN)', () => {
        const rows: CostRow[] = [
            { date: '2025-01-01', service: 'a', operations: 1, total_cost: null },
        ];
        const { byDate } = aggregateByDate(rows);
        expect(Number.isNaN(byDate['2025-01-01'])).toBe(false);
        expect(byDate['2025-01-01']).toBe(0);
    });
});

describe('buildPersonaCosts', () => {
    it('aggregates costs per persona via topic mapping', () => {
        const details: CostEntry[] = [
            { service: 'openai', operation: 'image', cost_usd: 0.04, topic_id: 't1', created_at: '' },
            { service: 'claude', operation: 'text', cost_usd: 0.02, topic_id: 't1', created_at: '' },
            { service: 'openai', operation: 'image', cost_usd: 0.04, topic_id: 't2', created_at: '' },
        ];
        const topicPersonaMap = new Map([['t1', 'p1'], ['t2', 'p2']]);
        const result = buildPersonaCosts(details, topicPersonaMap);
        expect(result['p1']).toBeCloseTo(0.06);
        expect(result['p2']).toBeCloseTo(0.04);
    });

    it('skips entries with null topic_id', () => {
        const details: CostEntry[] = [
            { service: 'openai', operation: 'image', cost_usd: 0.04, topic_id: null, created_at: '' },
        ];
        const result = buildPersonaCosts(details, new Map());
        expect(Object.keys(result)).toHaveLength(0);
    });

    it('skips entries whose topic_id is not in the map', () => {
        const details: CostEntry[] = [
            { service: 'openai', operation: 'image', cost_usd: 0.04, topic_id: 'orphan', created_at: '' },
        ];
        const result = buildPersonaCosts(details, new Map([['t1', 'p1']]));
        expect(Object.keys(result)).toHaveLength(0);
    });

    it('returns empty object for empty details', () => {
        expect(buildPersonaCosts([], new Map())).toEqual({});
    });
});
