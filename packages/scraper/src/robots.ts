import type { Redis } from 'ioredis';
import robotsParserImport from 'robots-parser';

interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}

const robotsParser = robotsParserImport as unknown as (url: string, text: string) => Robot;

export const USER_AGENT = 'distributed-rag-scraper/0.1 (+educational project)';
const CACHE_TTL_SECONDS = 60 * 60 * 24;

export interface RobotsCheck {
  allowed: boolean;
  crawlDelay?: number;
}

async function getRobotsText(redis: Redis, origin: string): Promise<string> {
  const cacheKey = `robots:${origin}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) return cached;

  let text = '';
  try {
    const response = await fetch(new URL('/robots.txt', origin), {
      headers: { 'user-agent': USER_AGENT },
    });
    text = response.ok ? await response.text() : '';
  } catch {
    text = '';
  }

  await redis.set(cacheKey, text, 'EX', CACHE_TTL_SECONDS);
  return text;
}

export async function checkRobots(redis: Redis, url: string): Promise<RobotsCheck> {
  const origin = new URL(url).origin;
  const text = await getRobotsText(redis, origin);
  const robots = robotsParser(new URL('/robots.txt', origin).toString(), text);

  const allowed = robots.isAllowed(url, USER_AGENT) ?? true;
  const crawlDelay = robots.getCrawlDelay(USER_AGENT);

  if (!allowed) {
    console.warn(`[robots] disallowed: ${url}`);
  }

  return { allowed, crawlDelay };
}
