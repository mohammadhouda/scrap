import { describe, expect, it } from 'vitest';
import { cleanHtml } from './clean.js';

describe('cleanHtml', () => {
  it('extracts article content via Readability and converts it to markdown', () => {
    const html = `
      <html>
        <head><title>My Article | Some Site</title></head>
        <body>
          <nav>Home | About</nav>
          <article>
            <h1>My Article</h1>
            <p>${'This is a long enough paragraph of real article content to satisfy Readability heuristics. '.repeat(6)}</p>
          </article>
          <footer>Copyright 2024</footer>
        </body>
      </html>
    `;

    const result = cleanHtml(html, 'https://example.com/article', 'My Article | Some Site');

    // Readability intentionally drops a leading <h1> that duplicates the
    // extracted title (it lives in `result.title` instead), so assert on the
    // body paragraph and the title separately rather than the heading text.
    expect(result.cleanedMd.length).toBeGreaterThan(0);
    expect(result.cleanedMd).toContain('real article content');
    expect(result.cleanedMd).not.toContain('Copyright 2024');
    expect(result.title).toContain('My Article');
  });

  it('falls back to the cleaned body when Readability finds no article', () => {
    const html = `
      <html>
        <head><title>Listing</title></head>
        <body>
          <script>console.log('nope')</script>
          <style>.a { color: red; }</style>
          <nav>Home</nav>
          <ul>
            <li>Item one</li>
            <li>Item two</li>
          </ul>
        </body>
      </html>
    `;

    const result = cleanHtml(html, 'https://example.com/listing', 'Listing');

    expect(result.cleanedMd.length).toBeGreaterThan(0);
    expect(result.cleanedMd).toContain('Item one');
    expect(result.cleanedMd).not.toContain('console.log');
    expect(result.title).toBe('Listing');
  });

  it('never returns empty cleanedMd for non-trivial input', () => {
    const html = '<html><body><p>Short page.</p></body></html>';
    const result = cleanHtml(html, 'https://example.com/short', 'Short');
    expect(result.cleanedMd.trim().length).toBeGreaterThan(0);
  });

  it('strips HTML comments (incl. ones hiding markup) from both extraction paths', () => {
    // Verbatim shape of the comment books.toscrape.com product pages ship --
    // a whole anchor block commented out. It must never reach cleanedMd.
    const commented = `
      <!--
        <a id="write_review" href="/catalogue/x/reviews/add/#addreview" class="btn btn-success btn-sm">
          Write a review
        </a>
      -->`;

    // Fallback path (short/listing page Readability can't parse).
    const listing = `
      <html><body>
        <ul><li>Item one</li><li>Item two</li></ul>
        ${commented}
      </body></html>`;
    const fallback = cleanHtml(listing, 'https://example.com/listing', 'Listing');
    expect(fallback.cleanedMd).toContain('Item one');
    expect(fallback.cleanedMd).not.toContain('write_review');
    expect(fallback.cleanedMd).not.toContain('btn btn-success');
    expect(fallback.cleanedMd).not.toContain('<!--');

    // Readability path (long-form article page) -- comment sits alongside the
    // article body and must be gone there too.
    const article = `
      <html><head><title>Real Article</title></head><body>
        <article>
          <h1>Real Article</h1>
          <p>${'This is a long enough paragraph of real article content to satisfy Readability heuristics. '.repeat(6)}</p>
          ${commented}
        </article>
      </body></html>`;
    const parsed = cleanHtml(article, 'https://example.com/article', 'Real Article');
    expect(parsed.cleanedMd).toContain('real article content');
    expect(parsed.cleanedMd).not.toContain('write_review');
    expect(parsed.cleanedMd).not.toContain('<!--');
  });

  it('strips tables from the markdown (they are captured separately by extractTables)', () => {
    const html = `
      <html>
        <body>
          <p>Some intro text.</p>
          <table><tr><th>UPC</th><td>abc123</td></tr></table>
        </body>
      </html>
    `;

    const result = cleanHtml(html, 'https://example.com/product', 'Product');

    expect(result.cleanedMd).toContain('Some intro text');
    expect(result.cleanedMd).not.toContain('<table>');
    expect(result.cleanedMd).not.toContain('abc123');
  });
});
