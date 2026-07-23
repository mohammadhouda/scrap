import { CrawlStatus, prisma } from '@scraper/db';
import { reserveUrlForRun, scrapeJobId, startCrawlRun } from '@scraper/scraper';
import { createQueues } from '../queues.js';
import { createRedisConnection } from '../redis.js';

// Benchmark harness for the horizontal-scaling demo (docs/benchmarks.md):
// enqueues one tracked crawl run for a source, waits for it to finalize, and
// reports wall-clock throughput. Run it against 1, 2, 4 worker replicas and
// compare pages/sec — the script itself does no scraping, so it measures the
// workers, not the host it runs on.
//
//   pnpm --filter @scraper/worker run bench [source-name]   (default: quotes-static)

const POLL_INTERVAL_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sourceName = process.argv[2] ?? 'quotes-static';
  const source = await prisma.source.findUnique({ where: { name: sourceName } });
  if (!source) {
    console.error(`no source named "${sourceName}" — run prisma:seed first`);
    process.exitCode = 1;
    return;
  }

  const connection = createRedisConnection();
  const queues = createQueues(connection);

  try {
    const crawlRunId = await startCrawlRun(source.id);
    await reserveUrlForRun(connection, crawlRunId, source.seedUrl);

    const startedAt = Date.now();
    await queues.scrape.add(
      'scrape',
      { sourceId: source.id, url: source.seedUrl, depth: 0, crawlRunId },
      { jobId: scrapeJobId(crawlRunId, source.seedUrl) },
    );
    console.log(`bench: crawl run ${crawlRunId} for "${source.name}" (${source.seedUrl})`);

    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } });
      const elapsedSec = (Date.now() - startedAt) / 1000;

      process.stdout.write(
        `\r  ${elapsedSec.toFixed(0)}s  queued=${run.pagesQueued} done=${run.pagesDone} failed=${run.pagesFailed}   `,
      );

      if (run.status !== CrawlStatus.RUNNING) {
        const settled = run.pagesDone + run.pagesFailed;
        console.log('\n');
        console.log(`status:      ${run.status}`);
        console.log(`elapsed:     ${elapsedSec.toFixed(1)}s`);
        console.log(`pages:       ${run.pagesDone} done, ${run.pagesFailed} failed, ${run.pagesQueued} queued`);
        console.log(`throughput:  ${(settled / elapsedSec).toFixed(2)} pages/sec`);
        if (settled !== run.pagesQueued) {
          console.log(
            `WARNING: settled (${settled}) != queued (${run.pagesQueued}) — lost or unaccounted jobs`,
          );
          process.exitCode = 1;
        }
        return;
      }
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
