export interface LinkFilterRules {
  seedUrl: string;
  allowPatterns: string[];
  denyPatterns: string[];
}

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
    if (deny.some((pattern) => pattern.test(normalized))) continue;
    if (allow.length > 0 && !allow.some((pattern) => pattern.test(normalized))) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
