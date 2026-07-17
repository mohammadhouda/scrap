import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@scraper/scraper', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@scraper/scraper');
  });
});
