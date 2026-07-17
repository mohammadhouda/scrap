import { PlaywrightCrawler, Request } from 'crawlee';
import type { FetchResult } from './fetch-result.js';

export async function playwrightFetch(url: string): Promise<FetchResult> {
  let result: FetchResult | undefined;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    requestHandler: async ({ page }) => {
      await page.waitForLoadState('networkidle');
      const html = await page.content();
      const links = await page.$$eval('a[href]', (anchors) =>
        anchors.map((a) => (a as HTMLAnchorElement).href),
      );
      result = {
        html,
        discoveredLinks: [...new Set(links)],
        title: await page.title(),
      };
    },
  });

  await crawler.run([new Request({ url })]);

  if (!result) {
    throw new Error(`playwright fetch produced no result: ${url}`);
  }

  return result;
}
