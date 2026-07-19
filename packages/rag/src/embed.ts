import OpenAI from 'openai';

const BATCH_SIZE = 100;
const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
  return err instanceof OpenAI.APIError && (err.status === 429 || (err.status ?? 0) >= 500);
}

export interface EmbedderOptions {
  apiKey?: string;
  model?: string;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

export function createEmbedder(options: EmbedderOptions = {}): Embedder {
  const model = options.model ?? process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';

  // Lazy: constructing OpenAI() throws if no API key is configured. Deferring
  // until the first real call means the worker can still start and process
  // scrape/discover jobs even before embeddings are configured.
  let client: OpenAI | undefined;
  function getClient(): OpenAI {
    client ??= new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
    return client;
  }

  async function embedBatch(batch: string[], attempt = 1): Promise<number[][]> {
    try {
      const response = await getClient().embeddings.create({ model, input: batch });
      return response.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 1000);
        return embedBatch(batch, attempt + 1);
      }
      throw err;
    }
  }

  return async function embedTexts(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      results.push(...(await embedBatch(batch)));
    }
    return results;
  };
}
