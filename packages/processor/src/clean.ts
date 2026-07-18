import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.use(gfm);

const STRIP_SELECTORS = 'script, style, noscript, nav, header, footer';

export interface CleanResult {
  cleanedMd: string;
  title: string | null;
}

export function cleanHtml(rawHtml: string, url: string, fallbackTitle: string | null): CleanResult {
  const dom = new JSDOM(rawHtml, { url });

  // Tables are captured separately (see tables.ts) and stored in
  // PageVersion.tables; strip them here so they don't get mangled into
  // prose markdown by turndown.
  dom.window.document.querySelectorAll('table').forEach((el) => el.remove());

  // Readability is tuned for long-form articles. Catalog/listing pages (like
  // our seeded sandbox sites) often have no single "main article", so it
  // returns little or nothing -- fall back to the cleaned full body so
  // cleanedMd is never empty.
  const article = new Readability(dom.window.document.cloneNode(true) as Document).parse();

  if (article?.content && article.textContent.trim().length > 0) {
    return {
      cleanedMd: turndown.turndown(article.content),
      title: article.title || fallbackTitle,
    };
  }

  dom.window.document.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());
  const bodyHtml = dom.window.document.body?.innerHTML ?? rawHtml;

  return {
    cleanedMd: turndown.turndown(bodyHtml),
    title: fallbackTitle,
  };
}
