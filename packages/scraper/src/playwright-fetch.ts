import { chromium, type Browser } from 'playwright';
import { parseRetryAfterMs, RateLimitedError } from './errors.js';
import type { FetchResult } from './fetch-result.js';
import { USER_AGENT } from './robots.js';

const NAV_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 5_000;

let browserPromise: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch().then((browser) => {
      // If Chromium crashes, forget the handle so the next fetch relaunches
      // instead of failing forever on a dead browser.
      browser.on('disconnected', () => {
        browserPromise = undefined;
      });
      return browser;
    });
    browserPromise.catch(() => {
      browserPromise = undefined;
    });
  }
  return browserPromise;
}

/** Closes the shared browser; called from the worker's graceful shutdown. */
export async function closePlaywright(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending) {
    const browser = await pending.catch(() => undefined);
    await browser?.close();
  }
}

export async function playwrightFetch(url: string): Promise<FetchResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT });

  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });

    if (response) {
      const status = response.status();
      if (status === 429 || status === 503) {
        const retryAfter = (await response.allHeaders())['retry-after'] ?? null;
        throw new RateLimitedError(url, status, parseRetryAfterMs(retryAfter));
      }
      if (status >= 400) {
        throw new Error(`fetch failed: ${status} ${url}`);
      }
    }

    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {
      // Never idle within the budget — proceed with whatever has rendered.
    });

    const html = await page.content();
    // Runs in the browser; typed structurally because this Node package
    // compiles without the DOM lib.
    const links = await page.$$eval('a[href]', (anchors) =>
      anchors.map((a) => (a as unknown as { href: string }).href),
    );
    const title = await page.title();

    return {
      html,
      discoveredLinks: [...new Set(links)],
      title: title || null,
    };
  } finally {
    await context.close();
  }
}
