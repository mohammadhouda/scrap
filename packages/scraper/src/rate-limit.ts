import type { Redis } from 'ioredis';

// Redis-backed token bucket keyed by domain. Atomic via a single Lua eval so
// concurrent workers hitting the same domain don't race past the refill math.
const REFILL_SCRIPT = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])

if tokens == nil then
  tokens = burst
  ts = now
end

local elapsedSeconds = math.max(0, now - ts) / 1000
tokens = math.min(burst, tokens + elapsedSeconds * rate)

local waitMs = 0
if tokens < 1 then
  waitMs = math.ceil((1 - tokens) / rate * 1000)
else
  tokens = tokens - 1
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, 3600)
return waitMs
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function acquireRateLimitSlot(
  redis: Redis,
  domain: string,
  ratePerSecond: number,
): Promise<void> {
  const key = `ratelimit:${domain}`;
  const burst = Math.max(1, Math.ceil(ratePerSecond));

  for (;;) {
    const waitMs = Number(
      await redis.eval(REFILL_SCRIPT, 1, key, ratePerSecond, burst, Date.now()),
    );
    if (waitMs <= 0) return;
    await sleep(waitMs);
  }
}
