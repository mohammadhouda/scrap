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

function cancelledKey(crawlRunId: string): string {
  return `crawl:${crawlRunId}:cancelled`;
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

export async function reserveUrlForRun(
  redis: Redis,
  crawlRunId: string,
  url: string,
): Promise<boolean> {
  // Cancelled runs stop expanding immediately: no new URLs are reserved, so
  // discovery fan-out halts even though already-queued jobs still drain.
  if (await redis.exists(cancelledKey(crawlRunId))) return false;

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

  
  await redis.del(outstandingKey(crawlRunId));
}

export async function cancelCrawlRun(redis: Redis, crawlRunId: string): Promise<boolean> {
  const { count } = await prisma.crawlRun.updateMany({
    where: { id: crawlRunId, status: CrawlStatus.RUNNING },
    data: { status: CrawlStatus.CANCELLED, finishedAt: new Date() },
  });

  if (count === 0) return false;

  await redis.set(cancelledKey(crawlRunId), '1', 'EX', KEY_TTL_SECONDS);
  await redis.del(outstandingKey(crawlRunId));
  return true;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

export interface ReconcileOptions {
  staleAfterMs?: number;
  now?: Date;
}

export async function reconcileStaleRuns(
  redis?: Redis,
  options: ReconcileOptions = {},
): Promise<number> {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const cutoff = new Date((options.now ?? new Date()).getTime() - staleAfterMs);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "CrawlRun"
    SET status = CASE
          WHEN "pagesDone" > 0 AND "pagesDone" + "pagesFailed" >= "pagesQueued"
            THEN 'SUCCEEDED'::"CrawlStatus"
          ELSE 'FAILED'::"CrawlStatus"
        END,
        "finishedAt" = now()
    WHERE status = 'RUNNING' AND "updatedAt" < ${cutoff}
    RETURNING id
  `;

  if (redis && rows.length > 0) {
    for (const { id } of rows) {
      await redis.del(outstandingKey(id), seenKey(id), settledKey(id), cancelledKey(id));
    }
  }

  return rows.length;
}
