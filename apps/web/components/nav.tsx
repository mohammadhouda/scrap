'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/ask', label: 'Ask' },
  { href: '/admin', label: 'Admin' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-zinc-900">
            <Search className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-semibold tracking-tight text-zinc-50">
            Scraper
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium transition-colors',
                  active ? 'bg-zinc-800/80 text-white' : 'text-zinc-400 hover:text-white',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
