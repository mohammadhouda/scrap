import { getLatestCrawls, getSources, type CrawlRun } from '@/lib/api';
import { ErrorState, Empty } from '@/components/ui/state';
import { SourceCreateForm } from '@/components/admin/source-create-form';
import { SourcesTable } from '@/components/admin/sources-table';

export default async function AdminSourcesPage() {
  let sources: Awaited<ReturnType<typeof getSources>> = [];
  let initialRuns: CrawlRun[] = [];
  let error: string | null = null;

  try {
    sources = await getSources();
    // Seed the table with the latest run per source; the client component then
    // polls /admin/crawls-data to keep progress live without a page refresh.
    try {
      initialRuns = await getLatestCrawls();
    } catch {
      // best-effort — an empty seed just shows "never crawled" until the first poll
    }
  } catch {
    error = 'Could not load sources.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Sources</h1>
        <p className="text-sm text-zinc-500">Register new crawl targets and trigger crawls.</p>
      </div>

      <SourceCreateForm />

      {error ? (
        <ErrorState message={error} />
      ) : sources.length === 0 ? (
        <Empty label="No sources registered yet." />
      ) : (
        <SourcesTable sources={sources} initialRuns={initialRuns} />
      )}
    </div>
  );
}
