import * as cheerio from 'cheerio';
import { decodeHtml } from './charset.js';
import { parseRetryAfterMs, RateLimitedError } from './errors.js';
import type { FetchResult } from './fetch-result.js';
import { USER_AGENT } from './robots.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — pages larger than this aren't worth indexing and risk OOM.

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true; // no header — optimistically attempt, cheerio handles junk gracefully
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml' || mediaType === '';
}

// Reads the body but aborts once MAX_BYTES is exceeded, so a hostile/huge
// response can't be buffered fully into memory before we reject it. Returns
// raw bytes: the charset isn't reliably known until the whole prefix is
// available (header, BOM, or <meta>), so decoding happens afterwards.
async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new Error(`response too large: ${declared} bytes > ${MAX_BYTES}`);
  }

  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`response exceeded ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function cheerioFetch(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 429 (and 503, which overloaded origins use the same way) is an explicit
  // "back off" — surface it as a typed error so the worker can open a shared
  // per-domain cooldown honoring Retry-After, instead of retrying blind.
  if (response.status === 429 || response.status === 503) {
    throw new RateLimitedError(url, response.status, parseRetryAfterMs(response.headers.get('retry-after')));
  }
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${url}`);
  }

  const contentType = response.headers.get('content-type');
  if (!isHtml(contentType)) {
    throw new Error(`unsupported content-type "${contentType}" for ${url}`);
  }

  const html = decodeHtml(await readCapped(response), contentType);
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
