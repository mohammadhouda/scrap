import { Prisma, prisma } from '@scraper/db';
import type { Embedder } from './embed.js';

export interface RetrievedChunk {
  chunkId: string;
  pageId: string;
  content: string;
  heading: string | null;
  url: string;
  title: string | null;
  sourceId: string;
}

export interface SearchOptions {
  topK?: number;
  sourceId?: string;
  /**
   * Cosine-similarity floor for semantic retrieval (0 disables). Without it,
   * a question with zero relevant indexed content still fills the prompt with
   * the topK *least-irrelevant* chunks, leaving "no answer" entirely up to
   * the LLM's judgment (docs/limitations.md #3). Keyword search needs no
   * floor: websearch_to_tsquery already requires a lexical match.
   */
  minSimilarity?: number;
}

const DEFAULT_TOP_K = 8;

// Conservative default for text-embedding-3-small: clearly-related chunks
// score well above this; unrelated corpora score below it. Tunable per call.
export const DEFAULT_MIN_SIMILARITY = 0.25;

function sourceFilter(sourceId: string | undefined, column: Prisma.Sql): Prisma.Sql {
  return sourceId ? Prisma.sql`AND ${column} = ${sourceId}` : Prisma.empty;
}

export async function semanticSearch(
  embedTexts: Embedder,
  query: string,
  options: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const [embedding] = await embedTexts([query]);
  if (!embedding) return [];

  const vectorLiteral = `[${embedding.join(',')}]`;
  const topK = options.topK ?? DEFAULT_TOP_K;
  const minSimilarity = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  // <=> is cosine distance; similarity = 1 - distance, so the floor becomes a
  // distance ceiling the index can still serve.
  const maxDistance = 1 - minSimilarity;

  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT c.id as "chunkId", p.id as "pageId", c.content, c.heading, p.url, pv.title, p."sourceId"
    FROM "Chunk" c
    JOIN "PageVersion" pv ON pv.id = c."pageVersionId"
    JOIN "Page" p ON p.id = pv."pageId"
    WHERE c.embedding <=> ${vectorLiteral}::vector <= ${maxDistance}
      ${sourceFilter(options.sourceId, Prisma.sql`p."sourceId"`)}
    ORDER BY c.embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `;
}

export async function keywordSearch(
  query: string,
  options: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = options.topK ?? DEFAULT_TOP_K;

  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT c.id as "chunkId", p.id as "pageId", c.content, c.heading, p.url, pv.title, p."sourceId"
    FROM "Chunk" c
    JOIN "PageVersion" pv ON pv.id = c."pageVersionId"
    JOIN "Page" p ON p.id = pv."pageId"
    WHERE c."contentTsv" @@ websearch_to_tsquery('english', ${query})
      ${sourceFilter(options.sourceId, Prisma.sql`p."sourceId"`)}
    ORDER BY ts_rank(c."contentTsv", websearch_to_tsquery('english', ${query})) DESC
    LIMIT ${topK}
  `;
}
