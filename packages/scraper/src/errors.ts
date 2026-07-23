// Thrown by the fetch layer when the origin explicitly pushed back (429 Too
// Many Requests, or 503 with the semantics of "back off"). Carries the
// server's requested delay so the worker can open a shared per-domain
// cooldown instead of retrying blind.
export class RateLimitedError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(url: string, status: number, retryAfterMs?: number) {
    super(`rate limited (${status}) by ${new URL(url).hostname}: ${url}`);
    this.name = 'RateLimitedError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parses a Retry-After header value into milliseconds. The header is either
 * a delta in whole seconds ("120") or an HTTP-date ("Wed, 21 Oct 2026 07:28:00
 * GMT"). Returns undefined for a missing/unparseable value or a date in the
 * past — callers fall back to their own default cooldown.
 */
export function parseRetryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;

  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;

  const delta = dateMs - now;
  return delta > 0 ? delta : undefined;
}
