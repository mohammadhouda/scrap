import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageVersion = {
  id: 'pv-2',
  pageId: 'page-1',
  version: 2,
  cleanedMd: '# Hello\nSome content.',
  title: 'Hello',
  tables: [] as unknown,
};

const { findUniqueOrThrow, findFirst } = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  findFirst: vi.fn(),
}));
vi.mock('@scraper/db', () => ({
  prisma: { pageVersion: { findUniqueOrThrow, findFirst } },
}));

const { chunkPage, clearChunksForVersions, createEmbedder, storeChunks, embedTexts } = vi.hoisted(() => {
  const embedTexts = vi.fn();
  return {
    chunkPage: vi.fn(),
    clearChunksForVersions: vi.fn(),
    createEmbedder: vi.fn(() => embedTexts),
    storeChunks: vi.fn(),
    embedTexts,
  };
});

vi.mock('@scraper/rag', () => ({
  chunkPage,
  clearChunksForVersions,
  createEmbedder,
  storeChunks,
}));

const { processIndexJob } = await import('./index-worker.js');

describe('processIndexJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueOrThrow.mockResolvedValue(pageVersion);
    findFirst.mockResolvedValue({ id: 'pv-1' });
    chunkPage.mockResolvedValue([
      { index: 0, heading: 'Hello', content: 'Some content.', contentType: 'PROSE', tokenCount: 3 },
    ]);
    embedTexts.mockResolvedValue([[0.1, 0.2]]);
  });

  it('clears chunks for both the current and previous version before indexing', async () => {
    await processIndexJob({ pageVersionId: 'pv-2' });

    expect(clearChunksForVersions).toHaveBeenCalledWith(['pv-2', 'pv-1']);
  });

  it('chunks, embeds, and stores the result', async () => {
    const result = await processIndexJob({ pageVersionId: 'pv-2' });
    const expectedChunks = [
      { index: 0, heading: 'Hello', content: 'Some content.', contentType: 'PROSE', tokenCount: 3 },
    ];

    expect(chunkPage).toHaveBeenCalledWith({
      cleanedMd: pageVersion.cleanedMd,
      title: pageVersion.title,
      tables: [],
    });
    expect(embedTexts).toHaveBeenCalledWith(['Some content.']);
    expect(storeChunks).toHaveBeenCalledWith('pv-2', expectedChunks, [[0.1, 0.2]]);
    expect(result).toEqual({ chunked: 1 });
  });

  it('skips embedding and storage when there are no chunks', async () => {
    chunkPage.mockResolvedValue([]);

    const result = await processIndexJob({ pageVersionId: 'pv-2' });

    expect(embedTexts).not.toHaveBeenCalled();
    expect(storeChunks).not.toHaveBeenCalled();
    expect(result).toEqual({ chunked: 0 });
  });

  it('handles a page with no previous version (first-ever index)', async () => {
    findFirst.mockResolvedValue(null);

    await processIndexJob({ pageVersionId: 'pv-2' });

    expect(clearChunksForVersions).toHaveBeenCalledWith(['pv-2', undefined]);
  });
});
