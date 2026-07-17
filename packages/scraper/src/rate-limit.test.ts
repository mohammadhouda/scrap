import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { acquireRateLimitSlot } from './rate-limit.js';

// Mimics the Lua token-bucket script's math so the retry loop in
// acquireRateLimitSlot can be exercised without a real Redis instance.
function fakeRedisWithBucket(rate: number, burst: number): Redis {
  let tokens = burst;
  let ts = Date.now();

  return {
    eval: vi.fn(async () => {
      const now = Date.now();
      const elapsedSeconds = Math.max(0, now - ts) / 1000;
      tokens = Math.min(burst, tokens + elapsedSeconds * rate);
      ts = now;

      if (tokens < 1) {
        return Math.ceil(((1 - tokens) / rate) * 1000);
      }
      tokens -= 1;
      return 0;
    }),
  } as unknown as Redis;
}

describe('acquireRateLimitSlot', () => {
  it('resolves immediately when a token is available', async () => {
    const redis = fakeRedisWithBucket(1, 1);
    await expect(acquireRateLimitSlot(redis, 'example.com', 1)).resolves.toBeUndefined();
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('retries until a token frees up', async () => {
    vi.useFakeTimers();
    const redis = fakeRedisWithBucket(10, 1);

    // Drain the only token.
    await acquireRateLimitSlot(redis, 'example.com', 10);

    const pending = acquireRateLimitSlot(redis, 'example.com', 10);
    await vi.advanceTimersByTimeAsync(200);
    await expect(pending).resolves.toBeUndefined();

    vi.useRealTimers();
  });
});
