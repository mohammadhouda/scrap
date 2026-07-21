'use client';

import { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StartCrawlButton } from '@/components/admin/start-crawl-button';
import { CancelCrawlButton } from '@/components/admin/cancel-crawl-button';
import { CrawlStatusCell } from '@/components/admin/crawl-status';
import type { CrawlRun, Source } from '@/lib/api';

const POLL_INTERVAL_MS = 2000;

function toMap(runs: CrawlRun[]): Record<string, CrawlRun> {
  return Object.fromEntries(runs.map((run) => [run.sourceId, run]));
}

export function SourcesTable({
  sources,
  initialRuns,
}: {
  sources: Source[];
  initialRuns: CrawlRun[];
}) {
  const [runsBySource, setRunsBySource] = useState<Record<string, CrawlRun>>(() =>
    toMap(initialRuns),
  );

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch('/admin/crawls-data', { cache: 'no-store' });
        if (!response.ok) return;
        const runs = (await response.json()) as CrawlRun[];
        if (!cancelled) setRunsBySource(toMap(runs));
      } catch {
        // transient failure — keep the last known values, try again next tick
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
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
        {sources.map((source) => {
          const latest = runsBySource[source.id] ?? null;
          return (
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
                <CrawlStatusCell run={latest} />
              </TableCell>
              <TableCell>
                {latest?.status === 'RUNNING' ? (
                  <CancelCrawlButton crawlRunId={latest.id} />
                ) : (
                  <StartCrawlButton sourceId={source.id} />
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
