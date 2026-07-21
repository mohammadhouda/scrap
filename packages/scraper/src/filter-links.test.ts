import { describe, expect, it } from 'vitest';
import { filterLinks } from './filter-links.js';

const rules = {
  seedUrl: 'https://example.com/docs',
  allowPatterns: ['^https://example\\.com/docs/'],
  denyPatterns: ['/private/'],
};

describe('filterLinks', () => {
  it('keeps links matching an allow pattern on the same origin', () => {
    const result = filterLinks(['https://example.com/docs/intro'], rules);
    expect(result).toEqual(['https://example.com/docs/intro']);
  });

  it('drops links on a different origin', () => {
    const result = filterLinks(['https://other.com/docs/intro'], rules);
    expect(result).toEqual([]);
  });

  it('drops links matching a deny pattern even if allowed', () => {
    const result = filterLinks(['https://example.com/docs/private/secret'], rules);
    expect(result).toEqual([]);
  });

  it('drops links that match no allow pattern', () => {
    const result = filterLinks(['https://example.com/blog/post'], rules);
    expect(result).toEqual([]);
  });

  it('drops malformed URLs', () => {
    const result = filterLinks(['not-a-url'], rules);
    expect(result).toEqual([]);
  });

  it('allows everything on-origin when there are no allow patterns', () => {
    const result = filterLinks(['https://example.com/anything'], {
      ...rules,
      allowPatterns: [],
    });
    expect(result).toEqual(['https://example.com/anything']);
  });

  it('strips the #fragment so anchored links dedupe to the base page', () => {
    const result = filterLinks(
      [
        'https://example.com/docs/intro#message',
        'https://example.com/docs/intro#examples',
        'https://example.com/docs/intro',
      ],
      rules,
    );
    // All three collapse to a single canonical page.
    expect(result).toEqual(['https://example.com/docs/intro']);
  });

  it('deduplicates repeated links within a batch', () => {
    const result = filterLinks(
      ['https://example.com/docs/a', 'https://example.com/docs/a'],
      rules,
    );
    expect(result).toEqual(['https://example.com/docs/a']);
  });
});
