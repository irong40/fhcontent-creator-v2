'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PersonaSwitcher } from '@/components/persona-switcher';
import type { Persona } from '@/types/database';

interface PersonaStat {
    id: string;
    name: string;
    brand: string;
    topicsInProgress: number;
    published: number;
    scheduled: number;
    failed: number;
}

export default function DashboardPage() {
    const supabase = useMemo(() => createClient(), []);
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [personaStats, setPersonaStats] = useState<PersonaStat[]>([]);
    const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
    const [globalStats, setGlobalStats] = useState({
        personaCount: 0,
        topicCount: 0,
        readyCount: 0,
        publishedCount: 0,
        pendingPublishCount: 0,
        failedCount: 0,
    });
    const [costByService, setCostByService] = useState<Record<string, number>>({});
    const [totalCost, setTotalCost] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const [
                personasRes,
                topicsRes,
                readyRes,
                publishedRes,
                pendingRes,
                failedRes,
                costRes,
            ] = await Promise.all([
                supabase.from('personas').select('*').eq('is_active', true),
                supabase.from('topics').select('*', { count: 'exact', head: true }).in('status', ['draft', 'topics_approved', 'content_generating', 'content_ready']),
                supabase.from('content_pieces').select('*', { count: 'exact', head: true }).eq('status', 'ready'),
                supabase.from('topics').select('*', { count: 'exact', head: true }).eq('status', 'published'),
                supabase.from('topics').select('*', { count: 'exact', head: true }).in('status', ['approved', 'scheduled']),
                supabase.from('topics').select('*', { count: 'exact', head: true }).eq('status', 'failed'),
                supabase.from('cost_summary').select('*'),
            ]);

            const activePersonas = personasRes.data ?? [];
            setPersonas(activePersonas);

            setGlobalStats({
                personaCount: activePersonas.length,
                topicCount: topicsRes.count ?? 0,
                readyCount: readyRes.count ?? 0,
                publishedCount: publishedRes.count ?? 0,
                pendingPublishCount: pendingRes.count ?? 0,
                failedCount: failedRes.count ?? 0,
            });

            const services: Record<string, number> = {};
            let total = 0;
            if (costRes.data) {
                for (const row of costRes.data) {
                    const service = row.service || 'unknown';
                    const cost = Number(row.total_cost) || 0;
                    services[service] = (services[service] || 0) + cost;
                    total += cost;
                }
            }
            setCostByService(services);
            setTotalCost(total);

            // Per-persona stats — parallelize all persona queries
            if (activePersonas.length > 0) {
                const allResults = await Promise.all(
                    activePersonas.map(persona =>
                        Promise.all([
                            supabase.from('topics').select('*', { count: 'exact', head: true })
                                .eq('persona_id', persona.id)
                                .in('status', ['draft', 'topics_approved', 'content_generating', 'content_ready']),
                            supabase.from('topics').select('*', { count: 'exact', head: true })
                                .eq('persona_id', persona.id)
                                .eq('status', 'published'),
                            supabase.from('topics').select('*', { count: 'exact', head: true })
                                .eq('persona_id', persona.id)
                                .in('status', ['approved', 'scheduled']),
                            supabase.from('topics').select('*', { count: 'exact', head: true })
                                .eq('persona_id', persona.id)
                                .eq('status', 'failed'),
                        ])
                    )
                );

                setPersonaStats(activePersonas.map((persona, i) => {
                    const [inProgressRes, pubRes, schedRes, failRes] = allResults[i];
                    return {
                        id: persona.id,
                        name: persona.name,
                        brand: persona.brand,
                        topicsInProgress: inProgressRes.count ?? 0,
                        published: pubRes.count ?? 0,
                        scheduled: schedRes.count ?? 0,
                        failed: failRes.count ?? 0,
                    };
                }));
            }
            setLoading(false);
        }
        load();
    }, [supabase]);

    const displayStats = selectedPersonaId
        ? personaStats.filter(s => s.id === selectedPersonaId)
        : personaStats;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="container max-w-screen-2xl py-8">
            <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

            {personas.length > 1 && (
                <div className="mb-6">
                    <PersonaSwitcher
                        personas={personas}
                        selectedId={selectedPersonaId}
                        onSelect={setSelectedPersonaId}
                    />
                </div>
            )}

            {/* Global stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
                <Link href="/personas">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Active Personas</CardTitle>
                            <CardDescription>Creator profiles</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold text-amber-500">{globalStats.personaCount}</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link href="/plan">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Topics in Progress</CardTitle>
                            <CardDescription>Draft through content ready</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold">{globalStats.topicCount}</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link href="/plan">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Content Pieces Ready</CardTitle>
                            <CardDescription>Awaiting review</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold text-green-500">{globalStats.readyCount}</p>
                        </CardContent>
                    </Card>
                </Link>
                <Link href="/plan">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">Published</CardTitle>
                            <CardDescription>{globalStats.pendingPublishCount} approved/scheduled</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-4xl font-bold text-purple-500">{globalStats.publishedCount}</p>
                        </CardContent>
                    </Card>
                </Link>
                {globalStats.failedCount > 0 && (
                    <Link href="/plan">
                        <Card className="hover:border-red-500/50 transition-colors cursor-pointer border-red-500/30">
                            <CardHeader>
                                <CardTitle className="text-lg">Failed</CardTitle>
                                <CardDescription>Needs attention</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-4xl font-bold text-red-500">{globalStats.failedCount}</p>
                            </CardContent>
                        </Card>
                    </Link>
                )}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Cost Summary</CardTitle>
                        <CardDescription>All time from cost_summary view</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-4xl font-bold">${totalCost.toFixed(2)}</p>
                        {Object.entries(costByService).length > 0 && (
                            <div className="mt-2 space-y-1">
                                {Object.entries(costByService).sort((a, b) => b[1] - a[1]).map(([service, cost]) => (
                                    <div key={service} className="flex justify-between text-sm">
                                        <span className="text-muted-foreground capitalize">{service}</span>
                                        <span>${cost.toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
                <Link href="/api/health">
                    <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                        <CardHeader>
                            <CardTitle className="text-lg">API Status</CardTitle>
                            <CardDescription>8 service connections</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Click to check connectivity</p>
                        </CardContent>
                    </Card>
                </Link>
            </div>

            {/* Per-persona breakdown */}
            {displayStats.length > 0 && (
                <>
                    <h2 className="text-xl font-semibold mb-4">Per-Persona Breakdown</h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {displayStats.map(stat => (
                            <Link key={stat.id} href={`/plan?persona=${stat.id}`}>
                                <Card className="hover:border-amber-500/50 transition-colors cursor-pointer">
                                    <CardHeader>
                                        <CardTitle className="text-lg">{stat.name}</CardTitle>
                                        <CardDescription>{stat.brand}</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-1 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">In Progress</span>
                                                <span>{stat.topicsInProgress}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Scheduled</span>
                                                <span>{stat.scheduled}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Published</span>
                                                <span className="text-purple-500">{stat.published}</span>
                                            </div>
                                            {stat.failed > 0 && (
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Failed</span>
                                                    <span className="text-red-500">{stat.failed}</span>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
