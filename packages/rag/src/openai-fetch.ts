import type { Fetch } from 'openai/core';

// Why this exists:
//
// `@scraper/processor` pulls in jsdom (via @mozilla/readability), and jsdom
// calls undici's `setGlobalDispatcher` at import time — installing a *userland*
// undici Agent (undici@7.28.0, hoisted from cheerio) as the process-wide
// dispatcher. From then on every `globalThis.fetch` call, including the OpenAI
// SDK's, is dispatched through that userland undici instead of Node's built-in
// one. Userland undici@7.28.0 rejects a request that carries a manually-set
// `content-length` header ("invalid content-length header"), and the OpenAI
// SDK sets exactly that on its POST bodies — so in any process that also loads
// the processor (i.e. every worker), all embeddings and completions fail.
//
// The fix is dispatcher-agnostic: strip the SDK's `content-length` header and
// let whichever dispatcher is active recompute it from the body. This is
// always safe — undici derives the correct length — and needs no control over
// import order or the global dispatcher.
export function createOpenAIFetch(): Fetch {
  const fetchImpl = globalThis.fetch;
  const wrapped = (input: unknown, init?: Record<string, unknown>) => {
    if (init && init.headers) {
      const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
      headers.delete('content-length');
      init = { ...init, headers };
    }
    return (fetchImpl as (i: unknown, n?: unknown) => Promise<Response>)(input, init);
  };
  return wrapped as unknown as Fetch;
}
