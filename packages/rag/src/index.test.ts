import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@scraper/rag', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@scraper/rag');
  });
});
