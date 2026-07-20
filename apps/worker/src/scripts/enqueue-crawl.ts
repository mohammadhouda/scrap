import { prisma } from '@scraper/db';
import { reserveUrlForRun, scrapeJobId, startCrawlRun } from '@scraper/scraper';
import { createQueues } from '../queues.js';
import { createRedisConnection } from '../redis.js';

async function main() {
  const sourceName = process.argv[2];
  const sources = await prisma.source.findMany({
    where: sourceName ? { name: sourceName } : undefined,
  });

  if (sources.length === 0) {
    console.error(
      sourceName ? `no source named "${sourceName}"` : 'no sources found -- run prisma:seed first',
    );
    process.exitCode = 1;
    return;
  }

  const connection = createRedisConnection();
  const queues = createQueues(connection);

  try {
    for (const source of sources) {
      // Tracked run so operator-triggered crawls show progress/completion too.
      // The per-run jobId keeps this crawl independent of any concurrent run.
      const crawlRunId = await startCrawlRun(source.id);
      await reserveUrlForRun(connection, crawlRunId, source.seedUrl);
      await queues.scrape.add(
        'scrape',
        { sourceId: source.id, url: source.seedUrl, depth: 0, crawlRunId },
        { jobId: scrapeJobId(crawlRunId, source.seedUrl) },
      );
      console.log(`enqueued seed crawl for "${source.name}" (run ${crawlRunId}): ${source.seedUrl}`);
    }
  } finally {
    await connection.quit();
  }
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
