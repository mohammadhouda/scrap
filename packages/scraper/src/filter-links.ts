export interface LinkFilterRules {
  seedUrl: string;
  allowPatterns: string[];
  denyPatterns: string[];
}

// Obvious non-HTML resources by file extension. These get discovered as plain
// <a href> links (e.g. MDN pages link to a `contributors.txt` per page), but
// they're not crawlable pages fetching them just trips the content-type
// guard and, before this filter, burned all 5 retries into the DLQ. Matched
// against the pathname only, so query strings don't interfere.
const NON_HTML_EXT =
  /\.(txt|pdf|zip|gz|tgz|tar|rar|7z|png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|mjs|cjs|map|json|xml|rss|atom|csv|tsv|md|wasm|mp[34]|m4[av]|webm|ogg|wav|avi|mov|woff2?|ttf|otf|eot|dmg|exe|apk|iso)$/i;

export function filterLinks(links: string[], rules: LinkFilterRules): string[] {
  const seedOrigin = new URL(rules.seedUrl).origin;
  const allow = rules.allowPatterns.map((pattern) => new RegExp(pattern));
  const deny = rules.denyPatterns.map((pattern) => new RegExp(pattern));

  const seen = new Set<string>();
  const result: string[] = [];

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }

    url.hash = '';
    const normalized = url.toString();

    if (url.origin !== seedOrigin) continue;
    if (NON_HTML_EXT.test(url.pathname)) continue;
    if (deny.some((pattern) => pattern.test(normalized))) continue;
    if (allow.length > 0 && !allow.some((pattern) => pattern.test(normalized))) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
