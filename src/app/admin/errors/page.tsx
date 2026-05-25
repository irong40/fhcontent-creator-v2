'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { Database } from '@/types/database';

type ErrorRow = Database['public']['Tables']['errors']['Row'];
type FilterMode = 'unacked' | 'all' | 'acked';

export default function ErrorsPage() {
    const [errors, setErrors] = useState<ErrorRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterMode>('unacked');

    const ackedQuery = useMemo(() => {
        if (filter === 'unacked') return '?acknowledged=false';
        if (filter === 'acked') return '?acknowledged=true';
        return '';
    }, [filter]);

    async function load() {
        setLoading(true);
        const res = await fetch(`/api/errors${ackedQuery}`);
        if (!res.ok) {
            toast.error('Failed to load errors');
            setLoading(false);
            return;
        }
        const json = await res.json();
        setErrors(json.errors as ErrorRow[]);
        setLoading(false);
    }

    useEffect(() => {
        load();
    }, [ackedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

    async function toggleAck(id: string, acknowledged: boolean) {
        const res = await fetch(`/api/errors/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged }),
        });
        if (!res.ok) {
            toast.error('Failed to update error');
            return;
        }
        toast.success(acknowledged ? 'Acknowledged' : 'Reopened');
        await load();
    }

    return (
        <div className="container max-w-screen-2xl py-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Error Log</h1>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant={filter === 'unacked' ? 'default' : 'outline'}
                        onClick={() => setFilter('unacked')}
                    >
                        Unacknowledged
                    </Button>
                    <Button
                        size="sm"
                        variant={filter === 'acked' ? 'default' : 'outline'}
                        onClick={() => setFilter('acked')}
                    >
                        Acknowledged
                    </Button>
                    <Button
                        size="sm"
                        variant={filter === 'all' ? 'default' : 'outline'}
                        onClick={() => setFilter('all')}
                    >
                        All
                    </Button>
                </div>
            </div>

            {loading && <div className="text-muted-foreground">Loading…</div>}

            {!loading && errors.length === 0 && (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        No errors {filter !== 'all' ? `(${filter})` : ''}.
                    </CardContent>
                </Card>
            )}

            <div className="space-y-3">
                {errors.map((err) => (
                    <Card key={err.id} className={err.acknowledged ? 'opacity-60' : ''}>
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between gap-4">
                                <CardTitle className="text-sm font-mono flex items-center gap-2">
                                    <span className={severityClass(err.severity)}>{err.severity.toUpperCase()}</span>
                                    <span className="text-muted-foreground">·</span>
                                    <span>{err.source}</span>
                                    {err.persona_name && (
                                        <>
                                            <span className="text-muted-foreground">·</span>
                                            <span className="text-muted-foreground">{err.persona_name}</span>
                                        </>
                                    )}
                                </CardTitle>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{new Date(err.created_at).toLocaleString()}</span>
                                    <Button
                                        size="sm"
                                        variant={err.acknowledged ? 'outline' : 'default'}
                                        onClick={() => toggleAck(err.id, !err.acknowledged)}
                                    >
                                        {err.acknowledged ? 'Reopen' : 'Acknowledge'}
                                    </Button>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <pre className="whitespace-pre-wrap text-sm font-mono">{err.message}</pre>
                            {err.topic_id && (
                                <div className="mt-2">
                                    <Link
                                        href={`/review/${err.topic_id}`}
                                        className="text-xs text-blue-400 hover:underline"
                                    >
                                        View topic →
                                    </Link>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}

function severityClass(severity: ErrorRow['severity']): string {
    if (severity === 'error') return 'text-red-400';
    if (severity === 'warning') return 'text-yellow-400';
    return 'text-blue-400';
}
