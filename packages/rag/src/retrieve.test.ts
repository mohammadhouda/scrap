import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@scraper/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@scraper/db')>();
  return { ...actual, prisma: { $queryRaw: queryRaw } };
});

const { semanticSearch, keywordSearch } = await import('./retrieve.js');

const sampleRows = [
  {
    chunkId: 'c1',
    pageId: 'page-1',
    content: 'some content',
    heading: null,
    url: 'https://example.com',
    title: 'Example',
    sourceId: 'source-1',
  },
];

describe('semanticSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('embeds the query and returns the queried rows', async () => {
    const embedTexts = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    queryRaw.mockResolvedValue(sampleRows);

    const result = await semanticSearch(embedTexts, 'what is scraping?');

    expect(embedTexts).toHaveBeenCalledWith(['what is scraping?']);
    expect(result).toEqual(sampleRows);
  });

  it('returns an empty array without querying if embedding fails to produce a vector', async () => {
    const embedTexts = vi.fn().mockResolvedValue([]);

    const result = await semanticSearch(embedTexts, 'query');

    expect(result).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('keywordSearch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call an embedder and returns queried rows', async () => {
    queryRaw.mockResolvedValue(sampleRows);

    const result = await keywordSearch('scraping');

    expect(result).toEqual(sampleRows);
  });
});
