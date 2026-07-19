'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/state';
import type { QueueCount } from '@/lib/api';

const POLL_INTERVAL_MS = 2000;

export function QueueCounters() {
  const [counts, setCounts] = useState<QueueCount[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch('/admin/queues-data', { cache: 'no-store' });
        if (!response.ok) throw new Error('failed');
        const data = (await response.json()) as QueueCount[];
        if (!cancelled) {
          setCounts(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!counts && !error) return <Loading label="Loading queue status..." />;
  if (error && !counts) {
    return <p className="text-sm text-red-400">Could not load queue status.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {counts?.map((q) => (
        <Card key={q.name} className="hover:border-zinc-700">
          <CardHeader>
            <CardTitle className="capitalize">{q.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant={q.counts.active > 0 ? 'success' : 'secondary'}>
              active: {q.counts.active}
            </Badge>
            <Badge variant="secondary">wait: {q.counts.wait}</Badge>
            <Badge variant="secondary">completed: {q.counts.completed}</Badge>
            <Badge variant={q.counts.failed > 0 ? 'destructive' : 'secondary'}>
              failed: {q.counts.failed}
            </Badge>
            <Badge variant="secondary">delayed: {q.counts.delayed}</Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
