import { QUEUE_NAMES } from '@scraper/shared';
import { buildScrapeWorker } from './worker.js';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');

const scrapeWorker = buildScrapeWorker({
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  maxRetriesPerRequest: null,
});

scrapeWorker.on('ready', () => {
  console.log(`worker listening on queue "${QUEUE_NAMES.scrape}"`);
});

scrapeWorker.on('error', (err) => {
  console.error('worker error', err);
});
