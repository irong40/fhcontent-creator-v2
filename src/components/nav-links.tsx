'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { QuickPostDialog } from '@/components/quick-post-dialog';

const links = [
    { href: '/plan', label: 'Plan' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/costs', label: 'Costs' },
    { href: '/personas', label: 'Personas' },
    { href: '/api/health', label: 'API Status' },
];

export function NavLinks() {
    const pathname = usePathname();

    function isActive(href: string) {
        if (pathname === href || pathname.startsWith(href + '/')) return true;
        // Review pages are part of the Plan workflow
        if (href === '/plan' && pathname.startsWith('/review/')) return true;
        return false;
    }

    return (
        <nav className="flex items-center gap-6 text-sm">
            {links.map(({ href, label }) => {
                const active = isActive(href);
                return (
                    <Link
                        key={href}
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={`transition-colors hover:text-foreground/80 ${
                            active
                                ? 'text-foreground font-medium'
                                : 'text-foreground/60'
                        }`}
                    >
                        {label}
                    </Link>
                );
            })}
            <QuickPostDialog
                trigger={<Button variant="outline" size="sm">Quick Post</Button>}
            />
        </nav>
    );
}
