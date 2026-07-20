import { Badge } from '@/components/ui/badge';
import type { CrawlRun, CrawlStatus } from '@/lib/api';

const STATUS_VARIANT: Record<CrawlStatus, 'secondary' | 'success' | 'warning' | 'destructive'> = {
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'secondary',
};

export function CrawlStatusCell({ run }: { run: CrawlRun | null }) {
  if (!run) {
    return <span className="text-xs text-zinc-600">never crawled</span>;
  }

  const settled = run.pagesDone + run.pagesFailed;

  return (
    <div className="flex flex-col gap-1">
      <Badge variant={STATUS_VARIANT[run.status]}>{run.status.toLowerCase()}</Badge>
      <span className="text-xs text-zinc-500">
        {settled}/{run.pagesQueued} pages
        {run.pagesFailed > 0 ? ` · ${run.pagesFailed} failed` : ''}
      </span>
    </div>
  );
}
