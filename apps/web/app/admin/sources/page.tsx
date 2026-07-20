import { getCrawls, getSources, type CrawlRun } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ErrorState, Empty } from '@/components/ui/state';
import { SourceCreateForm } from '@/components/admin/source-create-form';
import { StartCrawlButton } from '@/components/admin/start-crawl-button';
import { CrawlStatusCell } from '@/components/admin/crawl-status';

export default async function AdminSourcesPage() {
  let sources: Awaited<ReturnType<typeof getSources>> = [];
  let error: string | null = null;
  const latestRunBySource = new Map<string, CrawlRun>();

  try {
    sources = await getSources();
    // Fetch the most recent crawl run for each source (best-effort — a source
    // with no runs or a transient error just shows "never crawled").
    await Promise.all(
      sources.map(async (source) => {
        try {
          const [latest] = await getCrawls(source.id, 1);
          if (latest) latestRunBySource.set(source.id, latest);
        } catch {
          // ignore per-source crawl-history failures
        }
      }),
    );
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Seed URL</TableHead>
              <TableHead>Depth</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Latest crawl</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell className="font-medium text-zinc-50">
                  {source.name}
                  {source.renderJs ? (
                    <Badge variant="secondary" className="ml-2">
                      JS
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-xs truncate font-mono text-xs">{source.seedUrl}</TableCell>
                <TableCell>{source.maxDepth}</TableCell>
                <TableCell>{source.ratePerSecond}/s</TableCell>
                <TableCell>
                  <CrawlStatusCell run={latestRunBySource.get(source.id) ?? null} />
                </TableCell>
                <TableCell>
                  <StartCrawlButton sourceId={source.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
