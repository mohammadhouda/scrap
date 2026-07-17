import * as cheerio from 'cheerio';
import type { FetchResult } from './fetch-result.js';
import { USER_AGENT } from './robots.js';

export async function cheerioFetch(url: string): Promise<FetchResult> {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${url}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const discoveredLinks = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      discoveredLinks.add(new URL(href, url).toString());
    } catch {
      // ignore malformed hrefs
    }
  });

  return {
    html,
    discoveredLinks: [...discoveredLinks],
    title: $('title').first().text() || null,
  };
}
