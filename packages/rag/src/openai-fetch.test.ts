import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAIFetch } from './openai-fetch.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('createOpenAIFetch', () => {
  it('strips a manually-set content-length before delegating to global fetch', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = spy as unknown as typeof fetch;

    const wrapped = createOpenAIFetch() as unknown as (
      input: string,
      init?: RequestInit,
    ) => Promise<Response>;

    await wrapped('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '123' },
      body: '{"x":1}',
    });

    const passedInit = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(passedInit.headers);
    expect(headers.has('content-length')).toBe(false);
    expect(headers.get('content-type')).toBe('application/json');
    // Body and method are preserved so undici can recompute the length.
    expect(passedInit.method).toBe('POST');
    expect(passedInit.body).toBe('{"x":1}');
  });

  it('passes through requests that have no headers', async () => {
    const spy = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = spy as unknown as typeof fetch;

    const wrapped = createOpenAIFetch() as unknown as (input: string) => Promise<Response>;
    await wrapped('https://api.openai.com/v1/models');

    expect(spy).toHaveBeenCalledWith('https://api.openai.com/v1/models', undefined);
  });
});
