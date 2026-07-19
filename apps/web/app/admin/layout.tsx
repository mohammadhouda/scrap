import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { getAdminToken, logout } from './actions';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/dlq', label: 'Dead-letter queue' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = await getAdminToken();

  if (!token) {
    return <div className="mx-auto max-w-sm">{children}</div>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <form action={logout}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Log out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
