import { Worker, type ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES } from '@scraper/shared';

export function buildScrapeWorker(connection: ConnectionOptions): Worker {
  return new Worker(
    QUEUE_NAMES.scrape,
    async (job) => {
      return { received: job.data };
    },
    { connection },
  );
}
