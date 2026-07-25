import { Badge } from '@/components/ui/badge';
import type { CrawlRun, CrawlStatus } from '@/lib/api';

const STATUS_VARIANT: Record<CrawlStatus, 'secondary' | 'success' | 'warning' | 'destructive'> = {
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'secondary',
};

// Deterministic thousands separators (no toLocaleString — its locale can differ
// between server and client render and trip a hydration mismatch).
function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function CrawlStatusCell({ run }: { run: CrawlRun | null }) {
  if (!run) {
    return <span className="text-xs text-zinc-600">never crawled</span>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={STATUS_VARIANT[run.status]}>{run.status.toLowerCase()}</Badge>
      <span className="text-xs text-zinc-500">
        {/* pagesDone (not done+failed) over the total, so the numerator is the
            pages actually crawled — failures are shown separately, not folded
            into the "pages" count. */}
        {fmt(run.pagesDone)} / {fmt(run.pagesQueued)} pages
        {run.pagesFailed > 0 ? (
          <span className="text-amber-500"> · {fmt(run.pagesFailed)} failed</span>
        ) : null}
      </span>
    </div>
  );
}
