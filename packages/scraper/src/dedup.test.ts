import { describe, expect, it } from 'vitest';
import { sha256 } from './dedup.js';

describe('sha256', () => {
  it('is deterministic for identical input', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('differs for different input', () => {
    expect(sha256('hello')).not.toBe(sha256('hello!'));
  });

  it('produces a 64-char hex digest', () => {
    expect(sha256('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});
