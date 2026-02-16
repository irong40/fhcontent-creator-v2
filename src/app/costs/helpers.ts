export type DateRange = '7d' | '30d' | 'all';

export interface CostRow {
    date: string | null;
    service: string | null;
    operations: number | null;
    total_cost: number | null;
}

export interface CostEntry {
    service: string;
    operation: string;
    cost_usd: number;
    topic_id: string | null;
    created_at: string;
}

export interface ServiceAggregate {
    operations: number;
    cost: number;
}

export function filterByDateRange(rows: CostRow[], range: DateRange): CostRow[] {
    if (range === 'all') return rows;
    const days = range === '7d' ? 7 : 30;
    const since = new Date(Date.now() - days * 86400000);
    return rows.filter(row => {
        if (!row.date) return true;
        return new Date(row.date) >= since;
    });
}

export function aggregateByService(rows: CostRow[]): { byService: Record<string, ServiceAggregate>; grandTotal: number } {
    const byService: Record<string, ServiceAggregate> = {};
    let grandTotal = 0;
    for (const row of rows) {
        const service = row.service || 'unknown';
        if (!byService[service]) byService[service] = { operations: 0, cost: 0 };
        byService[service].operations += row.operations ?? 0;
        byService[service].cost += Number(row.total_cost) || 0;
        grandTotal += Number(row.total_cost) || 0;
    }
    return { byService, grandTotal };
}

export function aggregateByDate(rows: CostRow[]): { byDate: Record<string, number>; sortedDates: string[] } {
    const byDate: Record<string, number> = {};
    for (const row of rows) {
        if (!row.date) continue;
        byDate[row.date] = (byDate[row.date] || 0) + (Number(row.total_cost) || 0);
    }
    const sortedDates = Object.keys(byDate).sort().reverse();
    return { byDate, sortedDates };
}

export function buildPersonaCosts(
    details: CostEntry[],
    topicPersonaMap: Map<string, string>,
): Record<string, number> {
    const costs: Record<string, number> = {};
    for (const entry of details) {
        if (!entry.topic_id) continue;
        const personaId = topicPersonaMap.get(entry.topic_id);
        if (!personaId) continue;
        costs[personaId] = (costs[personaId] || 0) + entry.cost_usd;
    }
    return costs;
}
