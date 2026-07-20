import { DelayedError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { prisma } from '@scraper/db';
import { cleanHtml, detectLanguage, extractTables } from '@scraper/processor';
import { QUEUE_NAMES } from '@scraper/shared';
import {
  checkRateLimit,
  checkRobots,
  cheerioFetch,
  filterLinks,
  persistVersion,
  playwrightFetch,
} from '@scraper/scraper';
import { WORKER_CONCURRENCY } from './config.js';
import type { Queues } from './queues.js';

export interface ScrapeJobData {
  sourceId: string;
  url: string;
  depth: number;
}

export type ScrapeJobResult =
  | { skipped: 'robots' }
  | { defer: number }
  | { unchanged: true }
  | { versioned: number };

export async function processScrapeJob(
  connection: Redis,
  queues: Queues,
  data: ScrapeJobData,
): Promise<ScrapeJobResult> {
  const { url, sourceId, depth } = data;
  const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });

  const robotsCheck = await checkRobots(connection, url);
  if (!robotsCheck.allowed) {
    return { skipped: 'robots' };
  }

  const effectiveRate = robotsCheck.crawlDelay
    ? Math.min(source.ratePerSecond, 1 / robotsCheck.crawlDelay)
    : source.ratePerSecond;

  // Non-blocking: if no token is available, ask the caller to defer this job
  // back to the queue rather than sleeping and holding the concurrency slot.
  // The check runs before any fetch, so a deferred job wastes no network work.
  const waitMs = await checkRateLimit(connection, new URL(url).hostname, effectiveRate);
  if (waitMs > 0) {
    return { defer: waitMs };
  }

  const result = source.renderJs ? await playwrightFetch(url) : await cheerioFetch(url);

  const { cleanedMd, title } = cleanHtml(result.html, url, result.title);

  // Atomic: dedup-by-content-hash and version bump happen in one transaction,
  // so concurrent scrapes of the same URL can't race to the same version number.
  const persisted = await persistVersion({
    sourceId,
    url,
    rawHtml: result.html,
    cleanedMd,
    title,
    tables: extractTables(result.html),
    language: detectLanguage(cleanedMd),
  });

  if (persisted.status === 'unchanged') {
    return { unchanged: true };
  }

  if (depth < source.maxDepth) {
    const filtered = filterLinks(result.discoveredLinks, {
      seedUrl: source.seedUrl,
      allowPatterns: source.allowPatterns,
      denyPatterns: source.denyPatterns,
    });

    if (filtered.length > 0) {
      await queues.discover.add('links', { sourceId, urls: filtered, parentDepth: depth });
    }
  }

  await queues.index.add('index', { pageVersionId: persisted.pageVersionId });

  return { versioned: persisted.version };
}

export function buildScrapeWorker(connection: Redis, queues: Queues): Worker<ScrapeJobData> {
  return new Worker<ScrapeJobData>(
    QUEUE_NAMES.scrape,
    async (job, token) => {
      const result = await processScrapeJob(connection, queues, job.data);

      if ('defer' in result) {
        // Move the job to delayed without consuming a retry attempt, then throw
        // DelayedError so BullMQ releases the slot instead of completing/failing.
        await job.moveToDelayed(Date.now() + result.defer, token);
        throw new DelayedError();
      }

      return result;
    },
    { connection, concurrency: WORKER_CONCURRENCY },
  );
}
