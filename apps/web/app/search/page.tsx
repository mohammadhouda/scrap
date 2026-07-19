import Link from 'next/link';
import { ApiError, getSources, search, type SearchMode } from '@/lib/api';
import { SearchBar } from '@/components/search-bar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty, ErrorState } from '@/components/ui/state';
import { cn } from '@/lib/utils';

const MODES: SearchMode[] = ['hybrid', 'semantic', 'keyword'];

function modeHref(q: string, mode: SearchMode, source?: string) {
  const qs = new URLSearchParams({ q, mode });
  if (source) qs.set('source', source);
  return `/search?${qs}`;
}

function FilterLink({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-sm capitalize transition-colors',
        active ? 'bg-white text-zinc-900 font-medium' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white',
      )}
    >
      {children}
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string; source?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? '';
  const mode: SearchMode = params.mode === 'semantic' || params.mode === 'keyword' ? params.mode : 'hybrid';
  const source = params.source;

  const sources = await getSources().catch(() => []);

  let results: Awaited<ReturnType<typeof search>>['results'] = [];
  let error: string | null = null;

  if (q) {
    try {
      const response = await search({ q, mode, source });
      results = response.results;
    } catch (err) {
      error = err instanceof ApiError ? err.message : 'Search failed. Is the API running?';
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SearchBar defaultValue={q} />

      {q ? (
        <div className="flex flex-col gap-8 sm:flex-row">
          <aside className="flex shrink-0 flex-col gap-6 sm:w-48">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Mode</h2>
              <div className="flex flex-col gap-0.5">
                {MODES.map((m) => (
                  <FilterLink key={m} active={m === mode} href={modeHref(q, m, source)}>
                    {m}
                  </FilterLink>
                ))}
              </div>
            </div>

            {sources.length > 0 ? (
              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Source
                </h2>
                <div className="flex flex-col gap-0.5">
                  <FilterLink active={!source} href={modeHref(q, mode)}>
                    All sources
                  </FilterLink>
                  {sources.map((s) => (
                    <FilterLink key={s.id} active={source === s.name} href={modeHref(q, mode, s.name)}>
                      {s.name}
                    </FilterLink>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>

          <div className="min-w-0 flex-1">
            {error ? (
              <ErrorState message={error} />
            ) : results.length === 0 ? (
              <Empty label={`No results for "${q}".`} />
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-zinc-500">
                  {results.length} result{results.length === 1 ? '' : 's'}
                </p>
                <ul className="flex flex-col gap-3">
                  {results.map((r) => (
                    <li key={r.chunkId}>
                      <Card className="transition-colors hover:border-zinc-700">
                        <CardContent className="flex flex-col gap-2 pt-4">
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={`/page/${r.pageId}`}
                              className="truncate text-sm font-medium text-zinc-50 hover:underline underline-offset-2"
                            >
                              {r.title ?? r.url}
                            </Link>
                            {r.heading ? <Badge variant="secondary">{r.heading}</Badge> : null}
                          </div>
                          <p className="truncate font-mono text-xs text-zinc-500">{r.url}</p>
                          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-400">{r.content}</p>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : (
        <Empty label="Enter a query above to search crawled content." />
      )}
    </div>
  );
}
