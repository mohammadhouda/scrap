import OpenAI from 'openai';
import type { Embedder } from './embed.js';
import { hybridSearch } from './hybrid.js';
import { keywordSearch, semanticSearch, type RetrievedChunk, type SearchOptions } from './retrieve.js';
import { buildPrompt, type PromptSource } from './prompt.js';

export interface Citation {
  n: number;
  url: string;
  title: string | null;
  chunkId: string;
}

export interface AskResult {
  answerStream: AsyncIterable<string>;
  citations: Citation[];
}

export type SearchMode = 'semantic' | 'keyword' | 'hybrid';

export interface AskOptions extends SearchOptions {
  mode?: SearchMode;
}

export interface AskerOptions {
  embedTexts: Embedder;
  apiKey?: string;
  model?: string;
}

const NO_SOURCES_ANSWER =
  "I couldn't find anything in the indexed sources that answers this question.";

async function* singleChunkStream(text: string): AsyncIterable<string> {
  yield text;
}

function toCitations(results: RetrievedChunk[]): Citation[] {
  return results.map((chunk, i) => ({ n: i + 1, url: chunk.url, title: chunk.title, chunkId: chunk.chunkId }));
}

function toPromptSources(results: RetrievedChunk[]): PromptSource[] {
  return results.map((chunk, i) => ({
    n: i + 1,
    url: chunk.url,
    title: chunk.title,
    heading: chunk.heading,
    content: chunk.content,
  }));
}

export type Asker = (question: string, options?: AskOptions) => Promise<AskResult>;

export function createAsker(options: AskerOptions): Asker {
  const model = options.model ?? process.env.LLM_MODEL ?? 'gpt-5.5';

  // Lazy, same rationale as embed.ts: don't crash worker/API startup just
  // because ANTHROPIC_API_KEY-style config isn't set yet.
  let client: OpenAI | undefined;
  function getClient(): OpenAI {
    client ??= new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
    return client;
  }

  return async function ask(question: string, askOptions: AskOptions = {}): Promise<AskResult> {
    const search =
      askOptions.mode === 'semantic'
        ? (q: string) => semanticSearch(options.embedTexts, q, askOptions)
        : askOptions.mode === 'keyword'
          ? (q: string) => keywordSearch(q, askOptions)
          : (q: string) => hybridSearch(options.embedTexts, q, askOptions);

    const results = await search(question);

    if (results.length === 0) {
      return { answerStream: singleChunkStream(NO_SOURCES_ANSWER), citations: [] };
    }

    const citations = toCitations(results);
    const { system, user } = buildPrompt(question, toPromptSources(results));

    const stream = await getClient().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: true,
    });

    async function* answerStream() {
      for await (const part of stream) {
        const delta = part.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    }

    return { answerStream: answerStream(), citations };
  };
}
