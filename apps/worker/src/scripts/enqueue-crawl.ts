import { prisma } from '@scraper/db';
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
      // No jobId here: this is an explicit, operator-triggered (re-)crawl, so
      // it should always run even if the seed URL was already visited.
      await queues.scrape.add('scrape', { sourceId: source.id, url: source.seedUrl, depth: 0 });
      console.log(`enqueued seed crawl for "${source.name}": ${source.seedUrl}`);
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
