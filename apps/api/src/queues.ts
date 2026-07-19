import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES } from '@scraper/shared';

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 24 * 3600 },
};

export function createQueues(connection: Redis) {
  return {
    scrape: new Queue(QUEUE_NAMES.scrape, { connection, defaultJobOptions }),
    discover: new Queue(QUEUE_NAMES.discover, { connection, defaultJobOptions }),
    index: new Queue(QUEUE_NAMES.index, { connection, defaultJobOptions }),
  };
}

export type Queues = ReturnType<typeof createQueues>;
