import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { checkRateLimit } from './rate-limit.js';

// Mimics the Lua token-bucket script's math so checkRateLimit can be exercised
// without a real Redis instance.
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

describe('checkRateLimit', () => {
  it('returns 0 when a token is available', async () => {
    const redis = fakeRedisWithBucket(1, 1);
    await expect(checkRateLimit(redis, 'example.com', 1)).resolves.toBe(0);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('returns a positive wait (without consuming a token) once the bucket is drained', async () => {
    const redis = fakeRedisWithBucket(10, 1);

    // Drain the only token.
    await expect(checkRateLimit(redis, 'example.com', 10)).resolves.toBe(0);

    // Next call has no token — should report a wait, not block.
    const waitMs = await checkRateLimit(redis, 'example.com', 10);
    expect(waitMs).toBeGreaterThan(0);
  });
});
