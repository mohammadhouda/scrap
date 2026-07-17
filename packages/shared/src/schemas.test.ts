import { describe, expect, it } from 'vitest';
import { sourceSchema } from './schemas.js';

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
