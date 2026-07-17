import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { checkRobots } from './robots.js';

function fakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
  } as unknown as Redis;
}

describe('checkRobots', () => {
  let redis: Redis;

  beforeEach(() => {
    redis = fakeRedis();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disallows a path blocked by robots.txt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'User-agent: *\nDisallow: /private/' })),
    );

    const result = await checkRobots(redis, 'https://example.com/private/page');
    expect(result.allowed).toBe(false);
  });

  it('allows a path not blocked by robots.txt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => 'User-agent: *\nDisallow: /private/' })),
    );

    const result = await checkRobots(redis, 'https://example.com/public/page');
    expect(result.allowed).toBe(true);
  });

  it('surfaces crawl-delay from robots.txt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => 'User-agent: *\nCrawl-delay: 5\nDisallow:',
      })),
    );

    const result = await checkRobots(redis, 'https://example.com/page');
    expect(result.crawlDelay).toBe(5);
  });

  it('defaults to allowed when robots.txt cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await checkRobots(redis, 'https://example.com/page');
    expect(result.allowed).toBe(true);
  });

  it('caches the fetched robots.txt in redis', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => 'User-agent: *\nDisallow:' }));
    vi.stubGlobal('fetch', fetchMock);

    await checkRobots(redis, 'https://example.com/a');
    await checkRobots(redis, 'https://example.com/b');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
