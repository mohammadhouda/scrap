import { CrawlStatus, prisma } from '@scraper/db';
import { reserveUrlForRun, scrapeJobId, startCrawlRun } from '@scraper/scraper';
import { createQueues } from '../queues.js';
import { createRedisConnection } from '../redis.js';

// Benchmark harness for the horizontal-scaling demo (docs/benchmarks.md):
// enqueues one tracked crawl run for a source, waits for the crawl to truly
// quiesce, and reports wall-clock throughput. Run it against 1, 2, 4 worker
// replicas and compare pages/sec — the script itself does no scraping, so it
// measures the workers, not the host it runs on.
//
//   pnpm --filter @scraper/worker run bench [source-name]   (default: quotes-static)
//
// Completion is defined by *quiescence*, not by the run's status flag: the
// crawl is done when settled == queued and neither counter has moved for
// STABLE_MS. This is deliberately robust to the premature-finalization race
// documented in docs/benchmarks.md — the status can flip to SUCCEEDED while
// discovery is still fanning out, and the counters are only eventually
// consistent. The bench reports that early flip (as `firstFinalizedAt`) as a
// finding rather than trusting it as the end of work.

const POLL_INTERVAL_MS = 1000;
const STABLE_MS = 6000;

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

    let lastSignature = '';
    let lastChangeAt = Date.now();
    let firstFinalizedAtSec: number | null = null;
    let firstFinalizedPages: number | null = null;

    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const run = await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRunId } });
      const elapsedSec = (Date.now() - startedAt) / 1000;
      const settled = run.pagesDone + run.pagesFailed;

      // Record the first time the run reported itself finalized, to quantify
      // how early the status flip fired relative to real completion.
      if (firstFinalizedAtSec === null && run.status !== CrawlStatus.RUNNING) {
        firstFinalizedAtSec = elapsedSec;
        firstFinalizedPages = settled;
      }

      const signature = `${run.pagesQueued}/${settled}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastChangeAt = Date.now();
      }

      process.stdout.write(
        `\r  ${elapsedSec.toFixed(0)}s  queued=${run.pagesQueued} done=${run.pagesDone} failed=${run.pagesFailed}   `,
      );

      const stableFor = Date.now() - lastChangeAt;
      const quiesced = settled === run.pagesQueued && stableFor >= STABLE_MS;
      if (quiesced) {
        // The measured crawl time excludes the trailing stability window we
        // spent confirming nothing else was in flight.
        const completedSec = elapsedSec - STABLE_MS / 1000;
        console.log('\n');
        console.log(`final status:   ${run.status}`);
        console.log(`crawl time:     ${completedSec.toFixed(1)}s  (to last page; excludes ${STABLE_MS / 1000}s stability window)`);
        console.log(`pages:          ${run.pagesDone} done, ${run.pagesFailed} failed, ${run.pagesQueued} queued`);
        console.log(`throughput:     ${(settled / completedSec).toFixed(2)} pages/sec`);
        console.log(
          `lost-job check: settled ${settled} == queued ${run.pagesQueued} -> ${settled === run.pagesQueued ? 'OK' : 'MISMATCH'}`,
        );
        if (firstFinalizedAtSec !== null && firstFinalizedPages !== settled) {
          console.log(
            `NOTE: run reported ${run.status} early at ${firstFinalizedAtSec.toFixed(1)}s with ` +
              `${firstFinalizedPages}/${run.pagesQueued} pages — premature finalization (see docs/benchmarks.md).`,
          );
        }
        if (settled !== run.pagesQueued) process.exitCode = 1;
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
