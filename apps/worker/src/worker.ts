import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { prisma } from '@scraper/db';
import { QUEUE_NAMES } from '@scraper/shared';
import {
  acquireRateLimitSlot,
  checkRobots,
  cheerioFetch,
  filterLinks,
  getLatestVersion,
  persistVersion,
  playwrightFetch,
  sha256,
  touchLastSeen,
} from '@scraper/scraper';
import type { Queues } from './queues.js';

export interface ScrapeJobData {
  sourceId: string;
  url: string;
  depth: number;
}

export async function processScrapeJob(connection: Redis, queues: Queues, data: ScrapeJobData) {
  const { url, sourceId, depth } = data;
  const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });

  const robotsCheck = await checkRobots(connection, url);
  if (!robotsCheck.allowed) {
    return { skipped: 'robots' as const };
  }

  const effectiveRate = robotsCheck.crawlDelay
    ? Math.min(source.ratePerSecond, 1 / robotsCheck.crawlDelay)
    : source.ratePerSecond;
  await acquireRateLimitSlot(connection, new URL(url).hostname, effectiveRate);

  const result = source.renderJs ? await playwrightFetch(url) : await cheerioFetch(url);

  // Phase 2 replaces this placeholder with the real Readability + Turndown pipeline.
  const cleanedMd = result.html;
  const contentHash = sha256(cleanedMd);

  const latest = await getLatestVersion(url);
  if (latest?.contentHash === contentHash) {
    await touchLastSeen(url);
    return { unchanged: true as const };
  }

  const pageVersion = await persistVersion({
    sourceId,
    url,
    rawHtml: result.html,
    cleanedMd,
    title: result.title,
  });

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

  await queues.index.add('index', { pageVersionId: pageVersion.id });

  return { versioned: pageVersion.version };
}

export function buildScrapeWorker(connection: Redis, queues: Queues): Worker<ScrapeJobData> {
  return new Worker<ScrapeJobData>(
    QUEUE_NAMES.scrape,
    (job) => processScrapeJob(connection, queues, job.data),
    { connection },
  );
}
