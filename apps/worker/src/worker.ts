import { DelayedError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { prisma } from '@scraper/db';
import { cleanHtml, detectLanguage, extractTables } from '@scraper/processor';
import { QUEUE_NAMES } from '@scraper/shared';
import {
  applyDomainCooldown,
  checkRateLimit,
  checkRobots,
  cheerioFetch,
  filterLinks,
  isCrawlCancelled,
  persistVersion,
  playwrightFetch,
  RateLimitedError,
  settleScrapeForRun,
} from '@scraper/scraper';
import { WORKER_CONCURRENCY } from './config.js';
import type { Queues } from './queues.js';

export interface ScrapeJobData {
  sourceId: string;
  url: string;
  depth: number;
  crawlRunId?: string;
}

export type ScrapeJobResult =
  | { skipped: 'robots' | 'cancelled' }
  | { defer: number }
  | { unchanged: true }
  | { versioned: number };

export async function processScrapeJob(
  connection: Redis,
  queues: Queues,
  data: ScrapeJobData,
): Promise<ScrapeJobResult> {
  const { url, sourceId, depth, crawlRunId } = data;

  // Bail before any DB/fetch/embed work if the run was cancelled. Jobs already
  // in the queue at cancel time drain here near-instantly instead of doing
  // (and paying for) work whose results nobody wants.
  if (crawlRunId && (await isCrawlCancelled(connection, crawlRunId))) {
    return { skipped: 'cancelled' };
  }

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

  let result;
  try {
    result = source.renderJs ? await playwrightFetch(url) : await cheerioFetch(url);
  } catch (err) {
    // The origin pushed back (429/503): open a shared cooldown for the whole
    // domain — checkRateLimit surfaces it to every worker, so the fleet backs
    // off, and this job's own retries defer against it too. Rethrowing keeps
    // the normal attempt budget: a persistently-hostile URL still ends up in
    // the DLQ after 5 attempts instead of bouncing forever.
    if (err instanceof RateLimitedError) {
      const hostname = new URL(url).hostname;
      const cooldownMs = await applyDomainCooldown(connection, hostname, err.retryAfterMs);
      console.warn(`[rate-limit] ${err.status} from ${hostname}, domain cooling down ${cooldownMs}ms`);
    }
    throw err;
  }

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
      await queues.discover.add('links', { sourceId, urls: filtered, parentDepth: depth, crawlRunId });
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

      // Terminal success (versioned / unchanged / robots-skip) — settle the
      // crawl-run counter. Terminal *failures* are settled in index.ts's
      // 'failed' handler once retries are exhausted. A cancelled-skip is NOT
      // settled: the run is already finalized, and counting it would keep
      // pagesDone climbing after the user cancelled.
      const cancelledSkip = 'skipped' in result && result.skipped === 'cancelled';
      if (job.data.crawlRunId && !cancelledSkip) {
        await settleScrapeForRun(connection, job.data.crawlRunId, job.data.url, 'done');
      }

      return result;
    },
    { connection, concurrency: WORKER_CONCURRENCY },
  );
}
