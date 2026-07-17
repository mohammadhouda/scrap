import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@scraper/processor', () => {
  it('loads', () => {
    expect(PACKAGE_NAME).toBe('@scraper/processor');
  });
});
