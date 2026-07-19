import Link from 'next/link';
import { getAdminToken } from '../actions';
import { getDlq } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Empty, ErrorState } from '@/components/ui/state';
import { RetryJobButton } from '@/components/admin/retry-job-button';
import { cn } from '@/lib/utils';

const QUEUES = ['scrape', 'discover', 'index'] as const;
type QueueName = (typeof QUEUES)[number];

export default async function AdminDlqPage({
  searchParams,
}: {
  searchParams: Promise<{ queue?: string }>;
}) {
  const { queue: queueParam } = await searchParams;
  const queue: QueueName = QUEUES.includes(queueParam as QueueName) ? (queueParam as QueueName) : 'scrape';

  const token = await getAdminToken();
  let jobs: Awaited<ReturnType<typeof getDlq>> = [];
  let error: string | null = null;

  try {
    if (token) jobs = await getDlq(token, queue);
  } catch {
    error = 'Could not load the dead-letter queue.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Dead-letter queue</h1>
        <p className="text-sm text-zinc-500">Jobs that failed all retry attempts.</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 w-fit">
        {QUEUES.map((q) => (
          <Link
            key={q}
            href={`/admin/dlq?queue=${q}`}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm capitalize transition-colors',
              q === queue ? 'bg-white text-zinc-900 font-medium' : 'text-zinc-400 hover:text-white',
            )}
          >
            {q}
          </Link>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : jobs.length === 0 ? (
        <Empty label="No failed jobs." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs text-zinc-400">{job.id}</TableCell>
                <TableCell className="max-w-sm truncate font-mono text-xs text-red-400">
                  {job.failedReason}
                </TableCell>
                <TableCell>{job.attemptsMade}</TableCell>
                <TableCell>
                  <RetryJobButton jobId={job.id} queue={queue} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
