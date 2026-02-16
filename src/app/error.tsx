'use client';

import Link from 'next/link';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="container max-w-screen-sm py-20 text-center">
            <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
            <p className="text-muted-foreground mb-6">
                {error.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex items-center justify-center gap-4">
                <button
                    onClick={reset}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                    Try again
                </button>
                <Link
                    href="/"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent"
                >
                    Back to Dashboard
                </Link>
            </div>
        </div>
    );
}
