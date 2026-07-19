import { getSources } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ErrorState, Empty } from '@/components/ui/state';
import { SourceCreateForm } from '@/components/admin/source-create-form';
import { StartCrawlButton } from '@/components/admin/start-crawl-button';

export default async function AdminSourcesPage() {
  let sources: Awaited<ReturnType<typeof getSources>> = [];
  let error: string | null = null;

  try {
    sources = await getSources();
  } catch {
    error = 'Could not load sources.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sources</h1>
        <p className="text-sm text-slate-500">Register new crawl targets and trigger crawls.</p>
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
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell className="font-medium text-slate-900">
                  {source.name}
                  {source.renderJs ? (
                    <Badge variant="secondary" className="ml-2">
                      JS
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-xs truncate">{source.seedUrl}</TableCell>
                <TableCell>{source.maxDepth}</TableCell>
                <TableCell>{source.ratePerSecond}/s</TableCell>
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
