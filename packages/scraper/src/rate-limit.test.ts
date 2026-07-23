import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { applyDomainCooldown, checkRateLimit } from './rate-limit.js';

// Mimics the Lua token-bucket script's math (plus the cooldown key's
// pttl/set) so checkRateLimit can be exercised without a real Redis instance.
function fakeRedisWithBucket(rate: number, burst: number, cooldownMs = -2): Redis {
  let tokens = burst;
  let ts = Date.now();
  let cooldown = cooldownMs;

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
    pttl: vi.fn(async () => cooldown),
    set: vi.fn(async (_key: string, _value: string, _px: string, ms: number) => {
      cooldown = ms;
      return 'OK';
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

  it('returns the cooldown remainder without touching the bucket while a cooldown is active', async () => {
    const redis = fakeRedisWithBucket(10, 5, 4200);
    await expect(checkRateLimit(redis, 'example.com', 10)).resolves.toBe(4200);
    expect(redis.eval).not.toHaveBeenCalled();
  });
});

describe('applyDomainCooldown', () => {
  it('uses the default when no Retry-After was provided', async () => {
    const redis = fakeRedisWithBucket(1, 1);
    await expect(applyDomainCooldown(redis, 'example.com')).resolves.toBe(30_000);
  });

  it('honors a server-requested delay within bounds', async () => {
    const redis = fakeRedisWithBucket(1, 1);
    await expect(applyDomainCooldown(redis, 'example.com', 90_000)).resolves.toBe(90_000);
  });

  it('clamps a hostile delay to the 15-minute ceiling', async () => {
    const redis = fakeRedisWithBucket(1, 1);
    await expect(applyDomainCooldown(redis, 'example.com', 24 * 3600 * 1000)).resolves.toBe(
      15 * 60_000,
    );
  });

  it('clamps a zero/garbage delay up to the 1s floor', async () => {
    const redis = fakeRedisWithBucket(1, 1);
    await expect(applyDomainCooldown(redis, 'example.com', 0)).resolves.toBe(1_000);
  });

  it('never shortens an existing longer cooldown', async () => {
    const redis = fakeRedisWithBucket(1, 1, 60_000);
    await expect(applyDomainCooldown(redis, 'example.com', 5_000)).resolves.toBe(60_000);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
