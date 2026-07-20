import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

export interface RateLimitOptions {
  limit?: number;
  windowSeconds?: number;
}

const DEFAULT_LIMIT = Number(process.env.API_RATE_LIMIT ?? 30);
const DEFAULT_WINDOW_SECONDS = Number(process.env.API_RATE_WINDOW_SECONDS ?? 60);

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const noop: PreHandler = async () => {};

/**
 * Fixed-window per-IP limiter for the cost-bearing routes (`/search`, `/ask`)
 * — both spend money on OpenAI per call, so an unthrottled client is a
 * cost-amplification / DoS vector. Redis-backed so the limit holds across API
 * replicas. Returns a no-op when no Redis is provided (e.g. unit tests).
 */
export function createRateLimiter(
  redis: Redis | undefined,
  options: RateLimitOptions = {},
): PreHandler {
  if (!redis) return noop;

  const limit = options.limit ?? DEFAULT_LIMIT;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  return async function rateLimit(request, reply) {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `apirl:${request.ip}:${window}`;

    // INCR then EXPIRE: first hit in a window sets the TTL; subsequent hits just
    // bump the counter. A pipeline keeps it to one round trip.
    const [count] = (await redis
      .multi()
      .incr(key)
      .expire(key, windowSeconds)
      .exec()) as [[Error | null, number], [Error | null, number]];

    const hits = count?.[1] ?? 0;
    if (hits > limit) {
      await reply.code(429).send({ error: 'rate limit exceeded, slow down' });
    }
  };
}
