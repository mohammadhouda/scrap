import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetrievedChunk } from './retrieve.js';

const { semanticSearch, keywordSearch } = vi.hoisted(() => ({
  semanticSearch: vi.fn(),
  keywordSearch: vi.fn(),
}));

vi.mock('./retrieve.js', () => ({ semanticSearch, keywordSearch }));

const { hybridSearch } = await import('./hybrid.js');

function chunk(id: string): RetrievedChunk {
  return {
    chunkId: id,
    pageId: `page-${id}`,
    content: `content ${id}`,
    heading: null,
    url: `https://x.com/${id}`,
    title: null,
    sourceId: 's1',
  };
}

const embedTexts = vi.fn();

describe('hybridSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ranks a chunk appearing in both lists above one appearing in only one', async () => {
    semanticSearch.mockResolvedValue([chunk('a'), chunk('b')]);
    keywordSearch.mockResolvedValue([chunk('b'), chunk('c')]);

    const result = await hybridSearch(embedTexts, 'query');

    expect(result[0]?.chunkId).toBe('b'); // appears in both lists
    expect(result.map((c) => c.chunkId)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('deduplicates chunks appearing in both result sets', async () => {
    semanticSearch.mockResolvedValue([chunk('a')]);
    keywordSearch.mockResolvedValue([chunk('a')]);

    const result = await hybridSearch(embedTexts, 'query');

    expect(result).toHaveLength(1);
  });

  it('respects topK', async () => {
    semanticSearch.mockResolvedValue([chunk('a'), chunk('b'), chunk('c')]);
    keywordSearch.mockResolvedValue([]);

    const result = await hybridSearch(embedTexts, 'query', { topK: 2 });

    expect(result).toHaveLength(2);
  });

  it('queries both semantic and keyword search in parallel', async () => {
    semanticSearch.mockResolvedValue([]);
    keywordSearch.mockResolvedValue([]);

    await hybridSearch(embedTexts, 'query', { sourceId: 'source-1' });

    expect(semanticSearch).toHaveBeenCalledWith(embedTexts, 'query', { sourceId: 'source-1' });
    expect(keywordSearch).toHaveBeenCalledWith('query', { sourceId: 'source-1' });
  });
});
