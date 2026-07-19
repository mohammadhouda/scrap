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
    <div className="flex flex-col gap-6">
      <SearchBar defaultValue={q} />

      {q ? (
        <div className="flex flex-col gap-6 sm:flex-row">
          <aside className="flex shrink-0 flex-col gap-4 sm:w-48">
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</h2>
              <div className="flex flex-col gap-1">
                {MODES.map((m) => (
                  <Link
                    key={m}
                    href={modeHref(q, m, source)}
                    className={cn(
                      'rounded px-2 py-1 text-sm capitalize',
                      m === mode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {m}
                  </Link>
                ))}
              </div>
            </div>

            {sources.length > 0 ? (
              <div>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Source
                </h2>
                <div className="flex flex-col gap-1">
                  <Link
                    href={modeHref(q, mode)}
                    className={cn(
                      'rounded px-2 py-1 text-sm',
                      !source ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    All sources
                  </Link>
                  {sources.map((s) => (
                    <Link
                      key={s.id}
                      href={modeHref(q, mode, s.name)}
                      className={cn(
                        'rounded px-2 py-1 text-sm',
                        source === s.name ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                      )}
                    >
                      {s.name}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>

          <div className="flex-1">
            {error ? (
              <ErrorState message={error} />
            ) : results.length === 0 ? (
              <Empty label={`No results for "${q}".`} />
            ) : (
              <ul className="flex flex-col gap-3">
                {results.map((r) => (
                  <li key={r.chunkId}>
                    <Card>
                      <CardContent className="flex flex-col gap-2 pt-4">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/page/${r.pageId}`}
                            className="truncate text-sm font-medium text-slate-900 hover:underline"
                          >
                            {r.title ?? r.url}
                          </Link>
                          {r.heading ? <Badge variant="secondary">{r.heading}</Badge> : null}
                        </div>
                        <p className="truncate text-xs text-slate-500">{r.url}</p>
                        <p className="line-clamp-3 text-sm text-slate-700">{r.content}</p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <Empty label="Enter a query above to search crawled content." />
      )}
    </div>
  );
}
