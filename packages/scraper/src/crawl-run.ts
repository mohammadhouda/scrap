import type { Redis } from 'ioredis';
import { CrawlStatus, prisma } from '@scraper/db';
import { sha256 } from './dedup.js';

// Per-run Redis keys live for a day so a stalled/abandoned crawl can't leak
// them forever; every touch refreshes the TTL while the crawl is active.
const KEY_TTL_SECONDS = 60 * 60 * 24;

function seenKey(crawlRunId: string): string {
  return `crawl:${crawlRunId}:seen`;
}

function outstandingKey(crawlRunId: string): string {
  return `crawl:${crawlRunId}:outstanding`;
}

function settledKey(crawlRunId: string): string {
  return `crawl:${crawlRunId}:settled`;
}

export type ScrapeOutcome = 'done' | 'failed';

// Per-run scrape jobId: namespaced by run so concurrent crawls of the same
// source stay independent (intra-run dedup is handled by reserveUrlForRun).
export function scrapeJobId(crawlRunId: string, url: string): string {
  return `${crawlRunId}:${sha256(url)}`;
}

export async function startCrawlRun(sourceId: string): Promise<string> {
  const run = await prisma.crawlRun.create({
    data: { sourceId, status: CrawlStatus.RUNNING },
  });
  return run.id;
}

/**
 * Reserves a URL for a crawl run: returns true only the first time this URL is
 * seen in the run, and in that case bumps the run's queued count and the
 * outstanding-jobs counter. This is the single source of truth for "how many
 * scrape jobs belong to this run" — the atomic SADD makes it race-safe across
 * workers and independent of BullMQ's job-dedup / GC timing.
 *
 * Callers must only enqueue a scrape job when this returns true, so that every
 * reserved URL is matched by exactly one settleScrapeForRun call.
 */
export async function reserveUrlForRun(
  redis: Redis,
  crawlRunId: string,
  url: string,
): Promise<boolean> {
  const added = await redis.sadd(seenKey(crawlRunId), sha256(url));
  if (added === 0) return false;

  await redis
    .multi()
    .incr(outstandingKey(crawlRunId))
    .expire(outstandingKey(crawlRunId), KEY_TTL_SECONDS)
    .expire(seenKey(crawlRunId), KEY_TTL_SECONDS)
    .exec();

  await prisma.crawlRun.update({
    where: { id: crawlRunId },
    data: { pagesQueued: { increment: 1 } },
  });

  return true;
}

/**
 * Records a scrape job reaching a terminal state (success/skip = 'done', or a
 * final failure after all retries = 'failed'). Decrements the outstanding
 * counter; when it hits zero the run is finalized. Exactly one call per
 * reserved URL keeps the counter honest, so zero reliably means "crawl done".
 *
 * Idempotent per URL via a `settled` set — a job that retries for an unrelated
 * reason (or a settle that partially failed) won't double-count.
 */
export async function settleScrapeForRun(
  redis: Redis,
  crawlRunId: string,
  url: string,
  outcome: ScrapeOutcome,
): Promise<void> {
  const firstSettle = await redis.sadd(settledKey(crawlRunId), sha256(url));
  if (firstSettle === 0) return;
  await redis.expire(settledKey(crawlRunId), KEY_TTL_SECONDS);

  await prisma.crawlRun.update({
    where: { id: crawlRunId },
    data:
      outcome === 'done'
        ? { pagesDone: { increment: 1 } }
        : { pagesFailed: { increment: 1 } },
  });

  const remaining = await redis.decr(outstandingKey(crawlRunId));
  if (remaining > 0) return;

  // Exactly one worker observes the decrement reaching zero, so this finalizes
  // once. updateMany + where:{status:RUNNING} also guards against clobbering a
  // run that was cancelled in the meantime.
  const run = await prisma.crawlRun.findUnique({ where: { id: crawlRunId } });
  const finalStatus =
    run && run.pagesDone > 0 ? CrawlStatus.SUCCEEDED : CrawlStatus.FAILED;

  await prisma.crawlRun.updateMany({
    where: { id: crawlRunId, status: CrawlStatus.RUNNING },
    data: { status: finalStatus, finishedAt: new Date() },
  });

  await redis.del(outstandingKey(crawlRunId), seenKey(crawlRunId), settledKey(crawlRunId));
}
