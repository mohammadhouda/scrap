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

/**
 * Attempts to take one token from the per-domain bucket.
 *
 * Returns `0` when a token was consumed (proceed now), or the number of
 * milliseconds to wait before a token will be available (no token consumed).
 *
 * This deliberately does NOT block. The old blocking version slept inside the
 * BullMQ job handler, holding the worker's concurrency slot (and the job lock)
 * while idle — so a domain rate-limited to 1 req/s would park every worker
 * slot in `sleep()` and starve jobs for *other* domains. The caller now defers
 * the job back to the queue (`job.moveToDelayed`) instead, freeing the slot.
 */
export async function checkRateLimit(
  redis: Redis,
  domain: string,
  ratePerSecond: number,
): Promise<number> {
  // A reactive cooldown (opened when the origin answered 429/503) overrides
  // the proactive bucket: every worker sees it, so the whole fleet backs off
  // the domain, not just the job that got the 429.
  const cooldownRemaining = await redis.pttl(cooldownKey(domain));
  if (cooldownRemaining > 0) return cooldownRemaining;

  const key = `ratelimit:${domain}`;
  const burst = Math.max(1, Math.ceil(ratePerSecond));
  return Number(await redis.eval(REFILL_SCRIPT, 1, key, ratePerSecond, burst, Date.now()));
}

function cooldownKey(domain: string): string {
  return `ratelimit:cooldown:${domain}`;
}

// Bounds on the reactive cooldown: never shorter than 1s (a 0s/garbage
// Retry-After shouldn't disable the cooldown), never longer than 15 min (a
// hostile/broken header shouldn't park a domain for a day).
const COOLDOWN_DEFAULT_MS = 30_000;
const COOLDOWN_MIN_MS = 1_000;
const COOLDOWN_MAX_MS = 15 * 60_000;

/**
 * Opens (or extends) the shared per-domain cooldown after the origin pushed
 * back with 429/503. `requestedMs` comes from the Retry-After header when
 * present; otherwise a conservative default applies. An existing longer
 * cooldown is never shortened. Returns the cooldown now in effect (ms).
 */
export async function applyDomainCooldown(
  redis: Redis,
  domain: string,
  requestedMs?: number,
): Promise<number> {
  const ms = Math.min(COOLDOWN_MAX_MS, Math.max(COOLDOWN_MIN_MS, requestedMs ?? COOLDOWN_DEFAULT_MS));

  const key = cooldownKey(domain);
  const remaining = await redis.pttl(key);
  if (remaining >= ms) return remaining;

  await redis.set(key, '1', 'PX', ms);
  return ms;
}
