import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES } from '@scraper/shared';
import { reserveUrlForRun, scrapeJobId, sha256 } from '@scraper/scraper';
import { WORKER_CONCURRENCY } from './config.js';
import type { Queues } from './queues.js';

export interface DiscoverJobData {
  sourceId: string;
  urls: string[];
  parentDepth: number;
  crawlRunId?: string;
}
// Enqueues a scrape job per discovered URL. For a tracked crawl run each URL is
// reserved first (reserveUrlForRun) so the run's queued/outstanding counters
// stay exact and per-run deduped — only genuinely-new URLs get a scrape job.
// Untracked (manual) enqueues fall back to BullMQ's global jobId dedup.
export async function processDiscoverJob(queues: Queues, redis: Redis, data: DiscoverJobData) {
  const { sourceId, urls, parentDepth, crawlRunId } = data;
  const depth = parentDepth + 1;

  let enqueued = 0;
  for (const url of urls) {
    if (crawlRunId) {
      const reserved = await reserveUrlForRun(redis, crawlRunId, url);
      if (!reserved) continue;
      await queues.scrape.add(
        'scrape',
        { sourceId, url, depth, crawlRunId },
        { jobId: scrapeJobId(crawlRunId, url) },
      );
    } else {
      await queues.scrape.add('scrape', { sourceId, url, depth }, { jobId: sha256(url) });
    }
    enqueued += 1;
  }

  return { enqueued };
}

export function buildDiscoverWorker(connection: Redis, queues: Queues): Worker<DiscoverJobData> {
  return new Worker<DiscoverJobData>(
    QUEUE_NAMES.discover,
    (job) => processDiscoverJob(queues, connection, job.data),
    { connection, concurrency: WORKER_CONCURRENCY },
  );
}
