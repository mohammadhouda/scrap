import { QUEUE_NAMES } from '@scraper/shared';
import { buildDiscoverWorker } from './discover-worker.js';
import { createQueues } from './queues.js';
import { createRedisConnection } from './redis.js';
import { buildScrapeWorker } from './worker.js';

const connection = createRedisConnection();
const queues = createQueues(connection);

const scrapeWorker = buildScrapeWorker(connection, queues);
const discoverWorker = buildDiscoverWorker(connection, queues);

for (const worker of [scrapeWorker, discoverWorker]) {
  worker.on('ready', () => {
    console.log(`worker listening on queue "${worker.name}"`);
  });
  worker.on('failed', (job, err) => {
    console.error(`job ${job?.id} on queue "${worker.name}" failed`, err);
  });
  worker.on('error', (err) => {
    console.error(`worker error on queue "${worker.name}"`, err);
  });
}

console.log(`queues ready: ${Object.values(QUEUE_NAMES).join(', ')}`);
