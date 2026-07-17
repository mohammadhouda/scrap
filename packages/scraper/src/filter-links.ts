export interface LinkFilterRules {
  seedUrl: string;
  allowPatterns: string[];
  denyPatterns: string[];
}

export function filterLinks(links: string[], rules: LinkFilterRules): string[] {
  const seedOrigin = new URL(rules.seedUrl).origin;
  const allow = rules.allowPatterns.map((pattern) => new RegExp(pattern));
  const deny = rules.denyPatterns.map((pattern) => new RegExp(pattern));

  return links.filter((link) => {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return false;
    }

    if (url.origin !== seedOrigin) return false;
    if (deny.some((pattern) => pattern.test(url.toString()))) return false;
    if (allow.length > 0 && !allow.some((pattern) => pattern.test(url.toString()))) return false;

    return true;
  });
}
