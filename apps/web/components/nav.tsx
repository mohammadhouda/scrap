import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-sm font-semibold text-slate-900">
          Distributed RAG Scraper
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/search" className="hover:text-slate-900">
            Search
          </Link>
          <Link href="/ask" className="hover:text-slate-900">
            Ask
          </Link>
          <Link href="/admin" className="hover:text-slate-900">
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
