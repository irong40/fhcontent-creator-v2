'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    filterByDateRange,
    aggregateByService,
    aggregateByDate,
    buildPersonaCosts,
    type DateRange,
    type CostRow,
    type CostEntry,
} from './helpers';
import type { Persona } from '@/types/database';

export default function CostsPage() {
    const supabase = useMemo(() => createClient(), []);
    const [range, setRange] = useState<DateRange>('7d');
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [costRows, setCostRows] = useState<CostRow[]>([]);
    const [personaCosts, setPersonaCosts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const [personasRes, summaryRes] = await Promise.all([
                supabase.from('personas').select('*').eq('is_active', true),
                supabase.from('cost_summary').select('*'),
            ]);
            if (personasRes.data) setPersonas(personasRes.data);
            if (summaryRes.data) setCostRows(summaryRes.data);

            let query = supabase
                .from('cost_tracking')
                .select('service, operation, cost_usd, topic_id, created_at')
                .order('created_at', { ascending: false });

            if (range !== 'all') {
                const days = range === '7d' ? 7 : 30;
                const since = new Date(Date.now() - days * 86400000);
                query = query.gte('created_at', since.toISOString());
            }

            const { data: details } = await query.limit(500);
            if (details && details.length > 0) {
                const topicIds = [...new Set(details.filter(d => d.topic_id).map(d => d.topic_id!))];
                if (topicIds.length > 0) {
                    const { data: topics } = await supabase
                        .from('topics')
                        .select('id, persona_id')
                        .in('id', topicIds);

                    if (topics) {
                        const topicPersonaMap = new Map(topics.map(t => [t.id, t.persona_id]));
                        setPersonaCosts(buildPersonaCosts(details, topicPersonaMap));
                    }
                }
            }
            setLoading(false);
        }
        load();
    }, [supabase, range]);

    const filteredRows = useMemo(() => filterByDateRange(costRows, range), [costRows, range]);
    const { byService, grandTotal } = useMemo(() => aggregateByService(filteredRows), [filteredRows]);
    const { byDate, sortedDates } = useMemo(() => aggregateByDate(filteredRows), [filteredRows]);

    const personaName = (id: string) => personas.find(p => p.id === id)?.name ?? 'Unknown';

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="container max-w-screen-lg py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Cost Dashboard</h1>
                <div className="flex gap-2">
                    {(['7d', '30d', 'all'] as DateRange[]).map(r => (
                        <Button
                            key={r}
                            size="sm"
                            variant={range === r ? 'default' : 'outline'}
                            onClick={() => setRange(r)}
                        >
                            {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : 'All Time'}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Grand total */}
            <Card className="mb-6">
                <CardHeader>
                    <CardTitle>Total Spend ({range === '7d' ? 'Last 7 Days' : range === '30d' ? 'Last 30 Days' : 'All Time'})</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-4xl font-bold">${grandTotal.toFixed(2)}</p>
                </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2 mb-6">
                {/* By service */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">By Service</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {Object.keys(byService).length === 0 ? (
                            <p className="text-muted-foreground">No cost data yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {Object.entries(byService)
                                    .sort((a, b) => b[1].cost - a[1].cost)
                                    .map(([service, data]) => (
                                        <div key={service} className="flex items-center justify-between">
                                            <div>
                                                <span className="capitalize font-medium">{service}</span>
                                                <span className="text-muted-foreground text-xs ml-2">
                                                    {data.operations} ops
                                                </span>
                                            </div>
                                            <span className="font-mono">${data.cost.toFixed(2)}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* By persona */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">By Persona</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {Object.keys(personaCosts).length === 0 ? (
                            <p className="text-muted-foreground">No per-persona cost data yet.</p>
                        ) : (
                            <div className="space-y-2">
                                {Object.entries(personaCosts)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([personaId, cost]) => (
                                        <div key={personaId} className="flex items-center justify-between">
                                            <span className="font-medium">{personaName(personaId)}</span>
                                            <span className="font-mono">${cost.toFixed(2)}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Daily trend */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Daily Trend</CardTitle>
                </CardHeader>
                <CardContent>
                    {sortedDates.length === 0 ? (
                        <p className="text-muted-foreground">No daily data yet.</p>
                    ) : (
                        <div className="space-y-1">
                            {sortedDates.slice(0, 14).map(date => (
                                <div key={date} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{date}</span>
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="h-2 bg-amber-500 rounded"
                                            style={{
                                                width: `${Math.max(4, (byDate[date] / Math.max(...Object.values(byDate))) * 120)}px`,
                                            }}
                                        />
                                        <span className="font-mono w-16 text-right">${byDate[date].toFixed(2)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
