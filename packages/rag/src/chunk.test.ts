import { describe, expect, it } from 'vitest';
import { chunkPage } from './chunk.js';

describe('chunkPage', () => {
  it('retains the nearest heading as metadata for prose chunks', async () => {
    const cleanedMd = ['# Intro', 'Some intro text.', '## Details', 'Some detail text.'].join('\n');

    const chunks = await chunkPage({ cleanedMd, title: null, tables: [] });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ heading: 'Intro', contentType: 'PROSE' });
    expect(chunks[1]).toMatchObject({ heading: 'Details', contentType: 'PROSE' });
  });

  it('splits long sections into multiple chunks under the token budget', async () => {
    const longParagraph = 'This is a reasonably long sentence about scraping and RAG systems. '.repeat(
      200,
    );
    const cleanedMd = `# Long Section\n${longParagraph}`;

    const chunks = await chunkPage({ cleanedMd, title: null, tables: [] });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(800);
      expect(chunk.heading).toBe('Long Section');
    }
  });

  it('produces a table chunk per table with a synthesized caption', async () => {
    const chunks = await chunkPage({
      cleanedMd: '# Product',
      title: 'Widget',
      tables: [[{ UPC: 'abc123', Price: '$5' }]],
    });

    const tableChunk = chunks.find((c) => c.contentType === 'TABLE');
    expect(tableChunk).toBeDefined();
    expect(tableChunk?.content).toContain('Table (Widget):');
    expect(tableChunk?.content).toContain('UPC: abc123');
    expect(tableChunk?.content).toContain('Price: $5');
  });

  it('skips empty tables', async () => {
    const chunks = await chunkPage({ cleanedMd: '# Empty', tables: [[]], title: null });
    expect(chunks.some((c) => c.contentType === 'TABLE')).toBe(false);
  });

  it('assigns sequential indexes across prose and table chunks', async () => {
    const chunks = await chunkPage({
      cleanedMd: '# A\nprose text',
      title: null,
      tables: [[{ k: 'v' }]],
    });

    expect(chunks.map((c) => c.index)).toEqual([0, 1]);
  });

  it('handles content with no headings at all', async () => {
    const chunks = await chunkPage({ cleanedMd: 'Just a plain paragraph, no headings.', title: null, tables: [] });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ heading: null, contentType: 'PROSE' });
  });
});
