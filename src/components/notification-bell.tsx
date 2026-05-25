'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Database } from '@/types/database';

type ErrorRow = Database['public']['Tables']['errors']['Row'];

/**
 * Notification bell shown in the top nav. Polls /api/errors?acknowledged=false
 * every 60s for the unread count. Dropdown shows the 5 most recent.
 *
 * Poll cadence is deliberately slow — daily-publish runs hourly; a 1-minute
 * delay before the bell turns red is fine and keeps request count negligible
 * (60 req/hr per open tab).
 */
const POLL_INTERVAL_MS = 60_000;
const PREVIEW_LIMIT = 5;

export function NotificationBell() {
    const [errors, setErrors] = useState<ErrorRow[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/errors?acknowledged=false&limit=${PREVIEW_LIMIT}`);
            if (!res.ok) {
                setLoaded(true);
                return;
            }
            const json = await res.json();
            setErrors((json.errors as ErrorRow[]) ?? []);
            setLoaded(true);
        } catch {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [load]);

    // Click-outside close
    useEffect(() => {
        if (!open) return;
        function onClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    const unreadCount = errors.length;

    return (
        <div ref={containerRef} className="relative">
            <Button
                variant="ghost"
                size="icon"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                aria-expanded={open}
                className="relative"
                onClick={() => setOpen((v) => !v)}
            >
                <Bell className="h-4 w-4" />
                {loaded && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </Button>

            {open && (
                <div className="absolute right-0 top-full mt-2 w-96 rounded-md border border-border bg-background shadow-lg z-50">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                        <span className="text-sm font-medium">Unacknowledged errors</span>
                        <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {loaded && unreadCount === 0 && (
                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                All clear — no unacknowledged errors.
                            </div>
                        )}
                        {errors.map((err) => (
                            <Link
                                key={err.id}
                                href="/admin/errors"
                                onClick={() => setOpen(false)}
                                className="flex flex-col items-start gap-1 px-3 py-2 hover:bg-accent/50 border-b border-border/40 last:border-b-0"
                            >
                                <div className="flex items-center gap-2 text-xs w-full">
                                    <span className={severityClass(err.severity)}>{err.severity.toUpperCase()}</span>
                                    <span className="text-muted-foreground">{err.source}</span>
                                    <span className="ml-auto text-muted-foreground">
                                        {relativeTime(err.created_at)}
                                    </span>
                                </div>
                                <div className="text-sm font-mono truncate w-full">
                                    {err.message}
                                </div>
                            </Link>
                        ))}
                    </div>

                    <Link
                        href="/admin/errors"
                        onClick={() => setOpen(false)}
                        className="block px-3 py-2 text-center text-sm text-foreground/80 hover:text-foreground border-t border-border"
                    >
                        View all errors →
                    </Link>
                </div>
            )}
        </div>
    );
}

function severityClass(severity: ErrorRow['severity']): string {
    if (severity === 'error') return 'text-red-400';
    if (severity === 'warning') return 'text-yellow-400';
    return 'text-blue-400';
}

function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    const diffMin = Math.floor((Date.now() - then) / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
}
