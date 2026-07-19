import { prisma } from '@scraper/db';
import type { ChunkResult } from './chunk.js';

export async function clearChunksForVersions(pageVersionIds: Array<string | undefined>): Promise<void> {
  const ids = pageVersionIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await prisma.chunk.deleteMany({ where: { pageVersionId: { in: ids } } });
}

export async function storeChunks(
  pageVersionId: string,
  chunks: ChunkResult[],
  embeddings: number[][],
): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    const created = await prisma.chunk.create({
      data: {
        pageVersionId,
        index: chunk.index,
        heading: chunk.heading,
        content: chunk.content,
        contentType: chunk.contentType,
        tokenCount: chunk.tokenCount,
      },
    });

    const embedding = embeddings[i];
    if (embedding) {
      const vectorLiteral = `[${embedding.join(',')}]`;
      await prisma.$executeRaw`UPDATE "Chunk" SET embedding = ${vectorLiteral}::vector WHERE id = ${created.id}`;
    }
  }
}
