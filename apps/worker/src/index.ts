import { QUEUE_NAMES } from '@scraper/shared';
import { buildDiscoverWorker } from './discover-worker.js';
import { buildIndexWorker } from './index-worker.js';
import { createQueues } from './queues.js';
import { createRedisConnection } from './redis.js';
import { buildScrapeWorker } from './worker.js';

const connection = createRedisConnection();
const queues = createQueues(connection);

const scrapeWorker = buildScrapeWorker(connection, queues);
const discoverWorker = buildDiscoverWorker(connection, queues);
const indexWorker = buildIndexWorker(connection);

const workers = [scrapeWorker, discoverWorker, indexWorker];

for (const worker of workers) {
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

// Graceful shutdown: on SIGTERM/SIGINT (deploy, scale-down, Ctrl-C) let each
// worker finish its in-flight jobs and release its locks before exiting, so
// jobs aren't hard-killed and redelivered as duplicate work. worker.close()
// stops pulling new jobs and waits for active ones to complete.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, draining workers...`);
  try {
    await Promise.all(workers.map((worker) => worker.close()));
    await connection.quit();
    console.log('workers drained, exiting');
    process.exit(0);
  } catch (err) {
    console.error('error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
