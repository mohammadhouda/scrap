import { describe, expect, it } from 'vitest';
import { detectLanguage } from './language.js';

describe('detectLanguage', () => {
  it('detects English text', () => {
    const text =
      'The quick brown fox jumps over the lazy dog. This is a reasonably long sentence in English.';
    expect(detectLanguage(text)).toBe('eng');
  });

  it('detects French text', () => {
    const text =
      "Le renard brun rapide saute par-dessus le chien paresseux. Ceci est une phrase assez longue en français.";
    expect(detectLanguage(text)).toBe('fra');
  });

  it('returns null for very short text', () => {
    expect(detectLanguage('hi')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(detectLanguage('')).toBeNull();
  });
});
