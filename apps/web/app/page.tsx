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
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 text-center">
        <h1 className="text-3xl font-semibold text-slate-900">Distributed RAG Scraper</h1>
        <p className="text-slate-600">
          Search crawled content directly, or ask a question and get a cited answer.
        </p>
        <SearchBar className="mx-auto mt-2 w-full max-w-xl" />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {sources.map((source, i) => (
            <Card key={source.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{source.name}</CardTitle>
                  {source.renderJs ? <Badge variant="secondary">JS-rendered</Badge> : null}
                </div>
                <CardDescription className="truncate">{source.seedUrl}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold text-slate-900">
                  {counts[i] ?? '—'} <span className="text-sm font-normal text-slate-500">pages</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
