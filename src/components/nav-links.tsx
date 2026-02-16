'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
    { href: '/plan', label: 'Plan' },
    { href: '/costs', label: 'Costs' },
    { href: '/personas', label: 'Personas' },
    { href: '/api/health', label: 'API Status' },
];

export function NavLinks() {
    const pathname = usePathname();

    return (
        <nav className="flex items-center gap-6 text-sm">
            {links.map(({ href, label }) => (
                <Link
                    key={href}
                    href={href}
                    className={`transition-colors hover:text-foreground/80 ${
                        pathname === href || pathname.startsWith(href + '/')
                            ? 'text-foreground font-medium'
                            : 'text-foreground/60'
                    }`}
                >
                    {label}
                </Link>
            ))}
        </nav>
    );
}
