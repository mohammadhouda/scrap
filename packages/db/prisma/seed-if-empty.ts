import { PrismaClient } from '@prisma/client';

// Used by the docker-compose `migrate` service so `docker compose up` is
// idempotent: seed.ts wipes every table and flushes Redis, which is fine on a
// fresh database but catastrophic on a restart of a populated stack. Only run
// the full seed when there is nothing to lose.
const prisma = new PrismaClient();
const existingSources = await prisma.source.count();
await prisma.$disconnect();

if (existingSources > 0) {
  console.log(`database already has ${existingSources} source(s) — skipping seed`);
} else {
  await import('./seed.js');
}
