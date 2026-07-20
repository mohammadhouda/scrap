import { Prisma, prisma } from '@scraper/db';
import type { ChunkResult } from './chunk.js';

export async function clearChunksForVersions(pageVersionIds: Array<string | undefined>): Promise<void> {
  const ids = pageVersionIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await prisma.chunk.deleteMany({ where: { pageVersionId: { in: ids } } });
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export async function storeChunks(
  pageVersionId: string,
  chunks: ChunkResult[],
  embeddings: number[][],
): Promise<void> {
  if (chunks.length === 0) return;

  // A mismatch means an upstream bug (batching drift in the embedder); fail
  // loudly rather than silently persisting chunks with no / wrong vectors.
  if (chunks.length !== embeddings.length) {
    throw new Error(
      `storeChunks: ${chunks.length} chunks but ${embeddings.length} embeddings for pageVersion ${pageVersionId}`,
    );
  }

  // One transaction, two statements (a bulk insert + a single bulk vector
  // update) instead of the old 2N sequential round trips. Atomic: a mid-way
  // crash leaves the version with zero chunks (retried cleanly via
  // clearChunksForVersions) rather than a half-indexed, searchable page.
  await prisma.$transaction(async (tx) => {
    const created = await tx.chunk.createManyAndReturn({
      data: chunks.map((chunk) => ({
        pageVersionId,
        index: chunk.index,
        heading: chunk.heading,
        content: chunk.content,
        contentType: chunk.contentType,
        tokenCount: chunk.tokenCount,
      })),
      select: { id: true, index: true },
    });

    // Key by chunk.index (unique within a page version) rather than array
    // position — createManyAndReturn does not guarantee it preserves order.
    const embeddingByIndex = new Map(chunks.map((chunk, i) => [chunk.index, embeddings[i]]));

    const rows = created.map((row) => {
      const embedding = embeddingByIndex.get(row.index);
      if (!embedding) {
        throw new Error(`storeChunks: no embedding for chunk index ${row.index}`);
      }
      return Prisma.sql`(${row.id}::text, ${toVectorLiteral(embedding)}::vector)`;
    });

    // embedding is a raw-SQL pgvector column, so it can't go through the Prisma
    // create above — set every row's vector in one UPDATE ... FROM (VALUES ...).
    await tx.$executeRaw`
      UPDATE "Chunk" AS c
      SET embedding = v.embedding
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, embedding)
      WHERE c.id = v.id
    `;
  });
}
