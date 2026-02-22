'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PersonaSwitcher } from '@/components/persona-switcher';
import type { Persona } from '@/types/database';

interface CalendarTopic {
    id: string;
    title: string;
    status: string;
    publish_date: string;
    publish_time: string | null;
    persona_id: string;
    piece_count: number;
}

const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-yellow-600',
    content_generating: 'bg-blue-600',
    content_ready: 'bg-green-600',
    approved: 'bg-emerald-600',
    scheduled: 'bg-purple-600',
    publishing: 'bg-blue-600',
    published: 'bg-gray-600',
    failed: 'bg-red-600',
    partially_published: 'bg-orange-600',
};

const DRAGGABLE_STATUSES = ['content_ready', 'approved', 'scheduled'];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarPage() {
    const supabase = useMemo(() => createClient(), []);
    const searchParams = useSearchParams();
    const router = useRouter();

    const [personas, setPersonas] = useState<Persona[]>([]);
    const [topics, setTopics] = useState<CalendarTopic[]>([]);
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    });
    const [dragItem, setDragItem] = useState<string | null>(null);
    const [dragOverDate, setDragOverDate] = useState<string | null>(null);

    const selectedPersonaId = searchParams.get('persona');

    const setSelectedPersona = useCallback((id: string | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (id) {
            params.set('persona', id);
        } else {
            params.delete('persona');
        }
        router.push(`/calendar?${params.toString()}`);
    }, [searchParams, router]);

    const monthStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}`;

    // Load personas once
    useEffect(() => {
        async function loadPersonas() {
            const { data } = await supabase.from('personas').select('*').eq('is_active', true);
            if (data) setPersonas(data);
        }
        loadPersonas();
    }, [supabase]);

    // Load topics for the month
    const loadTopics = useCallback(async () => {
        const params = new URLSearchParams({ month: monthStr });
        if (selectedPersonaId) params.set('persona', selectedPersonaId);

        try {
            const res = await fetch(`/api/topics/calendar?${params.toString()}`);
            const data = await res.json();
            if (data.success) setTopics(data.topics);
        } catch {
            console.error('Failed to load calendar topics');
        }
    }, [monthStr, selectedPersonaId]);

    useEffect(() => { loadTopics(); }, [loadTopics]);

    // Build calendar grid
    const calendarDays = useMemo(() => {
        const firstDay = new Date(currentMonth.year, currentMonth.month, 1);
        const lastDay = new Date(currentMonth.year, currentMonth.month + 1, 0);
        const startPad = firstDay.getDay(); // 0=Sun
        const totalDays = lastDay.getDate();

        const days: Array<{ date: string | null; day: number | null }> = [];

        // Padding for start of month
        for (let i = 0; i < startPad; i++) days.push({ date: null, day: null });

        // Actual days
        for (let d = 1; d <= totalDays; d++) {
            const dateStr = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            days.push({ date: dateStr, day: d });
        }

        return days;
    }, [currentMonth]);

    // Group topics by date
    const topicsByDate = useMemo(() => {
        const map: Record<string, CalendarTopic[]> = {};
        for (const topic of topics) {
            if (!topic.publish_date) continue;
            const date = topic.publish_date.split('T')[0];
            if (!map[date]) map[date] = [];
            map[date].push(topic);
        }
        return map;
    }, [topics]);

    function prevMonth() {
        setCurrentMonth(prev => {
            if (prev.month === 0) return { year: prev.year - 1, month: 11 };
            return { year: prev.year, month: prev.month - 1 };
        });
    }

    function nextMonth() {
        setCurrentMonth(prev => {
            if (prev.month === 11) return { year: prev.year + 1, month: 0 };
            return { year: prev.year, month: prev.month + 1 };
        });
    }

    // Drag and drop handlers
    function handleDragStart(topicId: string, status: string) {
        if (!DRAGGABLE_STATUSES.includes(status)) return;
        setDragItem(topicId);
    }

    function handleDragOver(e: React.DragEvent, date: string) {
        e.preventDefault();
        setDragOverDate(date);
    }

    function handleDragLeave() {
        setDragOverDate(null);
    }

    async function handleDrop(e: React.DragEvent, targetDate: string) {
        e.preventDefault();
        setDragOverDate(null);

        if (!dragItem) return;

        const topic = topics.find(t => t.id === dragItem);
        if (!topic) return;
        setDragItem(null);

        // Optimistic update
        setTopics(prev => prev.map(t =>
            t.id === dragItem ? { ...t, publish_date: targetDate } : t
        ));

        try {
            const res = await fetch(`/api/topics/${dragItem}/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    publishDate: targetDate,
                    publishTime: topic.publish_time || '09:00',
                }),
            });

            const data = await res.json();
            if (!data.success) {
                toast.error(data.error || 'Reschedule failed');
                loadTopics(); // Revert
            } else {
                toast.success('Rescheduled');
            }
        } catch {
            toast.error('Reschedule failed');
            loadTopics(); // Revert
        }
    }

    const personaName = (personaId: string) =>
        personas.find(p => p.id === personaId)?.name ?? '';

    const monthLabel = new Date(currentMonth.year, currentMonth.month).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
    });

    const today = new Date().toISOString().split('T')[0];

    return (
        <div className="container max-w-screen-xl py-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Content Calendar</h1>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={prevMonth}>Prev</Button>
                    <span className="text-lg font-medium min-w-[180px] text-center">{monthLabel}</span>
                    <Button variant="outline" size="sm" onClick={nextMonth}>Next</Button>
                </div>
            </div>

            {/* Persona filter */}
            {personas.length > 1 && (
                <div className="mb-6">
                    <PersonaSwitcher
                        personas={personas}
                        selectedId={selectedPersonaId}
                        onSelect={setSelectedPersona}
                    />
                </div>
            )}

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
                {/* Day headers */}
                {DAYS_OF_WEEK.map(day => (
                    <div key={day} className="bg-muted/50 p-2 text-center text-sm font-medium text-muted-foreground">
                        {day}
                    </div>
                ))}

                {/* Day cells */}
                {calendarDays.map((cell, i) => (
                    <div
                        key={i}
                        className={`bg-card min-h-[120px] p-2 ${
                            cell.date === today ? 'ring-2 ring-primary ring-inset' : ''
                        } ${
                            dragOverDate === cell.date ? 'bg-primary/10' : ''
                        } ${
                            !cell.date ? 'bg-muted/20' : ''
                        }`}
                        onDragOver={cell.date ? (e) => handleDragOver(e, cell.date!) : undefined}
                        onDragLeave={cell.date ? handleDragLeave : undefined}
                        onDrop={cell.date ? (e) => handleDrop(e, cell.date!) : undefined}
                    >
                        {cell.day && (
                            <>
                                <span className={`text-xs font-medium ${
                                    cell.date === today ? 'text-primary' : 'text-muted-foreground'
                                }`}>
                                    {cell.day}
                                </span>
                                <div className="mt-1 space-y-1">
                                    {(topicsByDate[cell.date!] || []).map(topic => (
                                        <Link
                                            key={topic.id}
                                            href={`/review/${topic.id}`}
                                            draggable={DRAGGABLE_STATUSES.includes(topic.status)}
                                            onDragStart={() => handleDragStart(topic.id, topic.status)}
                                        >
                                            <Card className={`p-1.5 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow ${
                                                DRAGGABLE_STATUSES.includes(topic.status) ? 'cursor-grab active:cursor-grabbing' : ''
                                            }`}>
                                                <CardContent className="p-0">
                                                    <div className="flex items-start gap-1">
                                                        <Badge
                                                            className={`${STATUS_COLORS[topic.status] || 'bg-gray-500'} text-[10px] px-1 py-0 shrink-0`}
                                                        >
                                                            {topic.status.replace('_', ' ')}
                                                        </Badge>
                                                        {!selectedPersonaId && personas.length > 1 && (
                                                            <span className="text-[10px] text-amber-500 truncate">
                                                                {personaName(topic.persona_id)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs truncate mt-0.5" title={topic.title}>
                                                        {topic.title}
                                                    </p>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {topic.piece_count} pieces
                                                    </span>
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
