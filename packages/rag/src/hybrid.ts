import type { Embedder } from './embed.js';
import { keywordSearch, semanticSearch, type RetrievedChunk, type SearchOptions } from './retrieve.js';

// Reciprocal Rank Fusion: combine two ranked lists by 1/(k + rank) rather
// than raw scores, since cosine distance and ts_rank aren't comparable.
// k=60 is the standard RRF constant from the original paper.
const RRF_K = 60;

export async function hybridSearch(
  embedTexts: Embedder,
  query: string,
  options: SearchOptions = {},
): Promise<RetrievedChunk[]> {
  const [semanticResults, keywordResults] = await Promise.all([
    semanticSearch(embedTexts, query, options),
    keywordSearch(query, options),
  ]);

  const fused = new Map<string, { chunk: RetrievedChunk; score: number }>();

  const fold = (results: RetrievedChunk[]) => {
    results.forEach((chunk, rank) => {
      const contribution = 1 / (RRF_K + rank + 1);
      const existing = fused.get(chunk.chunkId);
      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(chunk.chunkId, { chunk, score: contribution });
      }
    });
  };

  fold(semanticResults);
  fold(keywordResults);

  const topK = options.topK ?? 8;
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((entry) => entry.chunk);
}
