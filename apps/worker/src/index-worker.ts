import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { prisma } from '@scraper/db';
import { chunkPage, clearChunksForVersions, createEmbedder, storeChunks } from '@scraper/rag';
import { QUEUE_NAMES } from '@scraper/shared';
import { WORKER_CONCURRENCY } from './config.js';

export interface IndexJobData {
  pageVersionId: string;
}

const embedTexts = createEmbedder();

export async function processIndexJob(data: IndexJobData) {
  const pageVersion = await prisma.pageVersion.findUniqueOrThrow({
    where: { id: data.pageVersionId },
  });

  const previous = await prisma.pageVersion.findFirst({
    where: { pageId: pageVersion.pageId, version: pageVersion.version - 1 },
    select: { id: true },
  });

  // Idempotent against job retries (clears this version's own partial index)
  // and keeps only the latest version's chunks searchable.
  await clearChunksForVersions([pageVersion.id, previous?.id]);

  const chunks = await chunkPage({
    cleanedMd: pageVersion.cleanedMd,
    title: pageVersion.title,
    tables: (pageVersion.tables as Array<Array<Record<string, string>>>) ?? [],
  });

  if (chunks.length === 0) {
    return { chunked: 0 };
  }

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  await storeChunks(pageVersion.id, chunks, embeddings);

  return { chunked: chunks.length };
}

export function buildIndexWorker(connection: Redis): Worker<IndexJobData> {
  return new Worker<IndexJobData>(QUEUE_NAMES.index, (job) => processIndexJob(job.data), {
    connection,
    concurrency: WORKER_CONCURRENCY,
  });
}
