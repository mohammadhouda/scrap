import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

const prisma = new PrismaClient();

const sources = [
  {
    name: 'quotes-static',
    seedUrl: 'http://quotes.toscrape.com/',
    allowPatterns: ['^http://quotes\\.toscrape\\.com/'],
    denyPatterns: [] as string[],
    renderJs: false,
    maxDepth: 15,
    ratePerSecond: 2,
  },
  {
    name: 'quotes-js',
    seedUrl: 'http://quotes.toscrape.com/js/',
    allowPatterns: ['^http://quotes\\.toscrape\\.com/js'],
    denyPatterns: [] as string[],
    renderJs: true,
    maxDepth: 15,
    ratePerSecond: 1,
  },
  {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript
    name: 'mdn-js',
    seedUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    allowPatterns: ['^https://developer\\.mozilla\\.org/en-US/docs/Web/JavaScript'],
    denyPatterns: [] as string[],
    renderJs: false,
    maxDepth: 2,
    ratePerSecond: 1,
  },
];

async function main() {
  console.log('clearing existing data...');
  await prisma.chunk.deleteMany();
  await prisma.pageVersion.deleteMany();
  await prisma.crawlRun.deleteMany();
  await prisma.page.deleteMany();
  await prisma.source.deleteMany();

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true });
  await redis.connect();
  await redis.flushdb();
  await redis.quit();
  console.log('flushed Redis queue state');

  for (const source of sources) {
    await prisma.source.create({ data: source });
  }
  console.log(`seeded ${sources.length} sources`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
