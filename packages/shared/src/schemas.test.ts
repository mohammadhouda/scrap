import { describe, expect, it } from 'vitest';
import { processedPageSchema, sourceSchema } from './schemas.js';

describe('sourceSchema', () => {
  it('applies defaults and accepts a minimal valid source', () => {
    const parsed = sourceSchema.parse({
      name: 'wikipedia',
      seedUrl: 'https://en.wikipedia.org',
    });

    expect(parsed.renderJs).toBe(false);
    expect(parsed.maxDepth).toBe(3);
    expect(parsed.ratePerSecond).toBe(1.0);
  });

  it('rejects an invalid seed URL', () => {
    const result = sourceSchema.safeParse({ name: 'x', seedUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });
});

describe('processedPageSchema', () => {
  it('accepts a fully populated processed page', () => {
    const result = processedPageSchema.safeParse({
      cleanedMd: '# Hello',
      title: 'Hello',
      tables: [[{ UPC: 'abc123' }]],
      language: 'eng',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null title/language and defaults tables to an empty array', () => {
    const result = processedPageSchema.safeParse({
      cleanedMd: 'content',
      title: null,
      language: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tables).toEqual([]);
    }
  });

  it('rejects an empty cleanedMd', () => {
    const result = processedPageSchema.safeParse({
      cleanedMd: '',
      title: null,
      tables: [],
      language: null,
    });
    expect(result.success).toBe(false);
  });
});
