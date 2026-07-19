import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetrievedChunk } from './retrieve.js';

const { hybridSearch } = vi.hoisted(() => ({ hybridSearch: vi.fn() }));
vi.mock('./hybrid.js', () => ({ hybridSearch }));

const { semanticSearch, keywordSearch } = vi.hoisted(() => ({
  semanticSearch: vi.fn(),
  keywordSearch: vi.fn(),
}));
vi.mock('./retrieve.js', () => ({ semanticSearch, keywordSearch }));

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create } };
  }
  return { default: MockOpenAI };
});

const { createAsker } = await import('./ask.js');

function chunk(id: string, sourceId: string, url: string): RetrievedChunk {
  return { chunkId: id, content: `content for ${id}`, heading: 'H', url, title: `Title ${id}`, sourceId };
}

async function* fakeOpenAiStream(parts: string[]) {
  for (const part of parts) {
    yield { choices: [{ delta: { content: part } }] };
  }
}

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const part of stream) out += part;
  return out;
}

const embedTexts = vi.fn();

describe('createAsker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a canned answer with no citations when nothing is retrieved', async () => {
    hybridSearch.mockResolvedValue([]);
    const ask = createAsker({ embedTexts, apiKey: 'test-key' });

    const result = await ask('What is the meaning of life?');

    expect(result.citations).toEqual([]);
    expect(await drain(result.answerStream)).toContain("couldn't find");
    expect(create).not.toHaveBeenCalled();
  });

  it('builds citations numbered by retrieval order and streams the answer', async () => {
    hybridSearch.mockResolvedValue([chunk('c1', 'source-a', 'https://a.com/1')]);
    create.mockResolvedValue(fakeOpenAiStream(['The answer', ' is [1].']));
    const ask = createAsker({ embedTexts, apiKey: 'test-key' });

    const result = await ask('What is X?');

    expect(result.citations).toEqual([
      { n: 1, url: 'https://a.com/1', title: 'Title c1', chunkId: 'c1' },
    ]);
    expect(await drain(result.answerStream)).toBe('The answer is [1].');
  });

  it('uses the requested search mode instead of hybrid', async () => {
    semanticSearch.mockResolvedValue([chunk('c1', 'source-a', 'https://a.com/1')]);
    create.mockResolvedValue(fakeOpenAiStream(['ok']));
    const ask = createAsker({ embedTexts, apiKey: 'test-key' });

    await ask('question', { mode: 'semantic' });

    expect(semanticSearch).toHaveBeenCalled();
    expect(hybridSearch).not.toHaveBeenCalled();
  });

  // Multi-source synthesis: a question whose retrieved chunks span two
  // different sites must produce citations pointing at both.
  it('produces citations spanning multiple sources when retrieval does', async () => {
    hybridSearch.mockResolvedValue([
      chunk('c1', 'source-quotes', 'http://quotes.toscrape.com/page/1'),
      chunk('c2', 'source-books', 'http://books.toscrape.com/catalogue/some-book'),
    ]);
    create.mockResolvedValue(
      fakeOpenAiStream(['Quotes are discussed [1] and books are catalogued [2].']),
    );
    const ask = createAsker({ embedTexts, apiKey: 'test-key' });

    const result = await ask('Compare quotes and books sites');
    const answer = await drain(result.answerStream);

    const citedSources = new Set(result.citations.map((c) => c.url));
    expect(citedSources).toEqual(
      new Set(['http://quotes.toscrape.com/page/1', 'http://books.toscrape.com/catalogue/some-book']),
    );
    expect(answer).toContain('[1]');
    expect(answer).toContain('[2]');
  });
});
