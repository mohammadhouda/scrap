import { Globe2, Sparkles } from 'lucide-react';
import { getPages, getSources } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/state';
import { SearchBar } from '@/components/search-bar';

export default async function HomePage() {
  let sources: Awaited<ReturnType<typeof getSources>> = [];
  let error: string | null = null;

  try {
    sources = await getSources();
  } catch {
    error = 'Could not reach the API. Is it running?';
  }

  const counts = await Promise.all(
    sources.map(async (source) => {
      try {
        const { total } = await getPages({ source: source.name, pageSize: 1 });
        return total;
      } catch {
        return null;
      }
    }),
  );

  return (
    <div className="flex flex-col gap-14">
      <div className="flex flex-col items-center gap-5 pt-6 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-medium text-zinc-400">
          <Sparkles className="h-3 w-3" />
          {sources.length > 0 ? `${sources.length} sources indexed` : 'Distributed crawl framework'}
        </span>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          Search the web,
          <br />
          get answers you can cite.
        </h1>
        <p className="max-w-md text-balance text-zinc-400">
          Search crawled content directly, or ask a question and get a grounded answer with source
          citations.
        </p>
        <SearchBar className="mt-2 w-full max-w-xl" />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : sources.length === 0 ? (
        <ErrorState message="No sources registered yet. Add one from the admin panel." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {sources.map((source, i) => (
            <Card
              key={source.id}
              className="group transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-700"
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800/80 text-zinc-400 group-hover:text-white">
                      <Globe2 className="h-3.5 w-3.5" />
                    </span>
                    <CardTitle>{source.name}</CardTitle>
                  </div>
                  {source.renderJs ? <Badge variant="secondary">JS-rendered</Badge> : null}
                </div>
                <CardDescription className="truncate font-mono text-xs">{source.seedUrl}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tracking-tight text-zinc-50">
                  {counts[i] ?? '—'}{' '}
                  <span className="text-sm font-normal text-zinc-500">pages indexed</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
