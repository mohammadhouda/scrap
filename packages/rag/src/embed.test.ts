import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

class FakeAPIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

vi.mock('openai', () => {
  class MockOpenAI {
    embeddings = { create };
    static APIError = FakeAPIError;
  }
  return { default: MockOpenAI };
});

const { createEmbedder } = await import('./embed.js');

function embeddingResponse(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      index: i,
      embedding: [i, i + 1],
      object: 'embedding' as const,
    })),
    model: 'text-embedding-3-small',
    object: 'list' as const,
    usage: { prompt_tokens: 0, total_tokens: 0 },
  };
}

describe('createEmbedder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('embeds a small batch in a single request', async () => {
    create.mockResolvedValue(embeddingResponse(3));
    const embedTexts = createEmbedder({ apiKey: 'test-key' });

    const result = await embedTexts(['a', 'b', 'c']);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(3);
  });

  it('splits more than 100 inputs into multiple batches', async () => {
    create.mockImplementation(async (params: { input: string[] }) =>
      embeddingResponse(params.input.length),
    );
    const embedTexts = createEmbedder({ apiKey: 'test-key' });

    const texts = Array.from({ length: 250 }, (_, i) => `text-${i}`);
    const result = await embedTexts(texts);

    expect(create).toHaveBeenCalledTimes(3); // 100 + 100 + 50
    expect(result).toHaveLength(250);
  });

  it('retries on a 429 and succeeds', async () => {
    vi.useFakeTimers();
    create
      .mockRejectedValueOnce(new FakeAPIError(429, 'rate limited'))
      .mockResolvedValueOnce(embeddingResponse(1));
    const embedTexts = createEmbedder({ apiKey: 'test-key' });

    const pending = embedTexts(['a']);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    vi.useRealTimers();
  });

  it('does not retry on a non-retryable error', async () => {
    create.mockRejectedValue(new FakeAPIError(400, 'bad request'));
    const embedTexts = createEmbedder({ apiKey: 'test-key' });

    await expect(embedTexts(['a'])).rejects.toThrow('bad request');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('re-sorts embeddings by index in case the API returns them out of order', async () => {
    create.mockResolvedValue({
      ...embeddingResponse(0),
      data: [
        { index: 1, embedding: [1], object: 'embedding' as const },
        { index: 0, embedding: [0], object: 'embedding' as const },
      ],
    });
    const embedTexts = createEmbedder({ apiKey: 'test-key' });

    const result = await embedTexts(['first', 'second']);

    expect(result).toEqual([[0], [1]]);
  });
});
