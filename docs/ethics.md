# Ethics and robots.txt review

Reviewed manually against each site's live `/robots.txt` before adding it
to `packages/db/prisma/seed.ts`. Re-check before any production/graded run,
since robots.txt can change.

## `quotes.toscrape.com` and `quotes.toscrape.com/js`

- **Purpose:** sandbox sites built by Scrapinghub/Zyte specifically for
  scraping practice — no `robots.txt`, no ToS, dummy data.
- **robots.txt:** none published (returns 404) — treated as "no
  restrictions," per standard convention (RFC 9309 §2.1: a missing
  robots.txt means full access is allowed).
- **Rate limit chosen:** 2 req/s (static), 1 req/s (JS-rendered — Playwright
  page loads are heavier on both ends, so lower concurrency is also just
  practical courtesy).
- **Disallowed paths skipped:** none (nothing disallowed).

## `developer.mozilla.org` (`/en-US/docs/Web/JavaScript` subtree)

- **Purpose:** 500+ page catalog leg. Chosen over a second toscrape.com
  sandbox because it has real, structurally rich technical content
  (headings, code blocks, tables) that gives the hybrid search and RAG
  `/ask` demo something substantive to retrieve and cite — sandbox filler
  text doesn't exercise chunking/citation quality in a meaningful way.
- **robots.txt** (`developer.mozilla.org/robots.txt`, checked 2026-07-20):
  `User-agent: *` has no blanket disallow. Three paths are blocked:
  `/api/`, `/*/files/`, `/media`. No `Crawl-delay` directive. Sitemap
  declared at `/sitemap.xml`.
  - The crawl is scoped via `allowPatterns:
    ['^https://developer\.mozilla\.org/en-US/docs/Web/JavaScript']` in the
    seed source, which never reaches any of the three disallowed paths —
    so no disallowed URL is ever enqueued in the first place, not merely
    skipped after the fact.
- **License/ToS:** MDN content is published under
  [CC-BY-SA 2.5](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license),
  which explicitly permits reuse (including republishing derivative
  excerpts) with attribution. This project is non-commercial coursework
  that stores content for search/retrieval and always surfaces the
  original source URL as a citation — consistent with attribution intent.
  No login, paywall, or explicit anti-scraping ToS clause applies to the
  docs subdomain.
- **Rate limit chosen:** 1 req/s. `developer.mozilla.org` is production
  infrastructure operated by the Mozilla Foundation (not a scraping
  sandbox), so despite no `Crawl-delay` directive being published, the
  crawl uses the same conservative default as the JS-rendered toscrape
  source rather than pushing to whatever the server would tolerate.
- **Disallowed paths skipped:** none encountered — `allowPatterns` keeps
  the crawl inside `/en-US/docs/Web/JavaScript`, which never overlaps
  `/api/`, `/*/files/`, or `/media`.

## General policy

- Every `Source.ratePerSecond` is enforced by a per-domain Redis token
  bucket (`packages/scraper/rate-limit.ts`), independent of `robots.txt`'s
  `Crawl-delay` — the configured rate is always at least as conservative
  as anything a site publishes.
- `packages/scraper/robots.ts` fetches and caches each domain's
  `robots.txt` (24h TTL) and every disallowed URL that would otherwise be
  enqueued is logged and skipped, regardless of whether `allowPatterns`
  already excludes it — defense in depth, not reliance on scope alone.
- No content requiring authentication, payment, or explicit opt-out is
  crawled by any configured source.
