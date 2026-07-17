import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES } from '@scraper/shared';
import { sha256 } from '@scraper/scraper';
import type { Queues } from './queues.js';

export interface DiscoverJobData {
  sourceId: string;
  urls: string[];
  parentDepth: number;
}

// jobId = sha256(url) lets BullMQ dedupe concurrent/in-flight enqueues of the
// same URL without a DB round trip; it does not block future re-crawls since
// completed jobs are GC'd (see queues.ts defaultJobOptions).
export async function processDiscoverJob(queues: Queues, data: DiscoverJobData) {
  const { sourceId, urls, parentDepth } = data;

  await Promise.all(
    urls.map((url) =>
      queues.scrape.add('scrape', { sourceId, url, depth: parentDepth + 1 }, { jobId: sha256(url) }),
    ),
  );

  return { enqueued: urls.length };
}

export function buildDiscoverWorker(connection: Redis, queues: Queues): Worker<DiscoverJobData> {
  return new Worker<DiscoverJobData>(
    QUEUE_NAMES.discover,
    (job) => processDiscoverJob(queues, job.data),
    { connection },
  );
}
