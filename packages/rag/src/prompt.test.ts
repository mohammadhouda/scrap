import { describe, expect, it } from 'vitest';
import { buildPrompt, extractCitedIndices } from './prompt.js';

describe('buildPrompt', () => {
  it('includes the citation-forcing instruction in the system prompt', () => {
    const { system } = buildPrompt('What is X?', []);
    expect(system).toContain('Cite every claim');
    expect(system).toContain('with [n]');
    expect(system).toContain('Do not invent sources or facts.');
  });

  it('numbers sources and includes url/title/heading/content', () => {
    const { user } = buildPrompt('What is X?', [
      { n: 1, url: 'https://a.com', title: 'Title A', heading: 'Heading A', content: 'Content A' },
      { n: 2, url: 'https://b.com', title: null, heading: null, content: 'Content B' },
    ]);

    expect(user).toContain('What is X?');
    expect(user).toContain('[1] URL: https://a.com | Title: Title A | Heading: Heading A');
    expect(user).toContain('Content A');
    expect(user).toContain('[2] URL: https://b.com | Title: Untitled | Heading: N/A');
    expect(user).toContain('Content B');
  });
});

describe('extractCitedIndices', () => {
  it('extracts unique citation numbers in ascending order', () => {
    const answer = 'Claim one [2]. Claim two [1]. Repeated claim [2] again.';
    expect(extractCitedIndices(answer)).toEqual([1, 2]);
  });

  it('returns an empty array when there are no citations', () => {
    expect(extractCitedIndices('No citations here.')).toEqual([]);
  });

  it('ignores malformed brackets', () => {
    expect(extractCitedIndices('See [n] or [ ] for details, but [3] is real.')).toEqual([3]);
  });
});
