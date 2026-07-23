import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs, RateLimitedError } from './errors.js';

describe('parseRetryAfterMs', () => {
  it('parses a delta-seconds value', () => {
    expect(parseRetryAfterMs('120')).toBe(120_000);
  });

  it('parses an HTTP-date relative to now', () => {
    const now = Date.parse('2026-07-23T12:00:00Z');
    expect(parseRetryAfterMs('Thu, 23 Jul 2026 12:00:30 GMT', now)).toBe(30_000);
  });

  it('returns undefined for a date in the past', () => {
    const now = Date.parse('2026-07-23T12:00:00Z');
    expect(parseRetryAfterMs('Thu, 23 Jul 2026 11:59:00 GMT', now)).toBeUndefined();
  });

  it('returns undefined for missing or garbage values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs('-5')).toBeUndefined();
  });
});

describe('RateLimitedError', () => {
  it('carries status and retryAfterMs and names the domain', () => {
    const err = new RateLimitedError('https://example.com/page', 429, 5000);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toContain('example.com');
    expect(err.message).toContain('429');
  });
});
