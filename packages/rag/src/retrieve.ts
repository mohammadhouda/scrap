import { Prisma, prisma } from '@scraper/db';
import type { Embedder } from './embed.js';

export interface RetrievedChunk {
  chunkId: string;
  content: string;
  heading: string | null;
  url: string;
  title: string | null;
  sourceId: string;
}

export interface SearchOptions {
  topK?: number;
  sourceId?: string;
}

const DEFAULT_TOP_K = 8;

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

  return prisma.$queryRaw<RetrievedChunk[]>`
    SELECT c.id as "chunkId", c.content, c.heading, p.url, pv.title, p."sourceId"
    FROM "Chunk" c
    JOIN "PageVersion" pv ON pv.id = c."pageVersionId"
    JOIN "Page" p ON p.id = pv."pageId"
    WHERE true ${sourceFilter(options.sourceId, Prisma.sql`p."sourceId"`)}
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
    SELECT c.id as "chunkId", c.content, c.heading, p.url, pv.title, p."sourceId"
    FROM "Chunk" c
    JOIN "PageVersion" pv ON pv.id = c."pageVersionId"
    JOIN "Page" p ON p.id = pv."pageId"
    WHERE c."contentTsv" @@ websearch_to_tsquery('english', ${query})
      ${sourceFilter(options.sourceId, Prisma.sql`p."sourceId"`)}
    ORDER BY ts_rank(c."contentTsv", websearch_to_tsquery('english', ${query})) DESC
    LIMIT ${topK}
  `;
}
