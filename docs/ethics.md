# Ethics and robots.txt review

Reviewed manually against each site's live `/robots.txt` before crawling.
Re-check before any production/graded run, since robots.txt can change.

The **seeded content source is `developer.mozilla.org`** (see
`packages/db/prisma/seed.ts`) — a real production site, so it gets the most
careful review below. The `toscrape.com` sandbox sites are documented after it
because they're used only as the controlled target for the horizontal-scaling
benchmark (`docs/benchmarks.md`), not as a content source.

## `developer.mozilla.org` (`/en-US/docs/Web/JavaScript` subtree) — primary source

- **Why MDN:** it has real, structurally rich technical content (headings, code
  blocks, tables) that gives hybrid search and the `/ask` RAG demo something
  substantive to retrieve and cite — sandbox filler text doesn't exercise
  chunking or citation quality in a meaningful way.
- **This is production infrastructure, not a scraping sandbox** — operated by
  the Mozilla Foundation — so the crawl is deliberately conservative on every
  axis (scope, rate, robots compliance) rather than pushing to whatever the
  server would tolerate.
- **robots.txt** (`developer.mozilla.org/robots.txt`, checked 2026-07-20):
  `User-agent: *` has **no blanket disallow**. Three path prefixes are blocked —
  `/api/`, `/*/files/`, `/media` — and there is **no `Crawl-delay`** directive.
  A sitemap is declared at `/sitemap.xml`.
- **Scope keeps the crawl clear of every disallowed path.** The seed source sets
  `allowPatterns: ['^https://developer\.mozilla\.org/en-US/docs/Web/JavaScript']`,
  which never overlaps `/api/`, `/*/files/`, or `/media` — so no disallowed URL
  is ever *enqueued* in the first place, not merely skipped after the fact. The
  crawl is further bounded by `maxDepth: 2` (the seed plus two link-hops), so it
  stays within the JavaScript reference and doesn't fan out across all of MDN.
- **License / ToS:** MDN content is published under
  [CC-BY-SA 2.5](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license),
  which explicitly permits reuse — including republishing derivative excerpts —
  **with attribution**. This project is non-commercial coursework that stores
  content for search/retrieval and **always surfaces the original source URL as
  a citation**, consistent with the attribution requirement. No login, paywall,
  or anti-scraping ToS clause applies to the docs subdomain.
- **Rate limit chosen:** **1 req/s.** Even though no `Crawl-delay` is published,
  the crawl self-limits to one request per second per the courtesy argument
  above. At `maxDepth: 2` this keeps total load on MDN modest and spread out.
- **Identification:** requests send a descriptive `User-agent`
  (`packages/scraper/robots.ts`) rather than masquerading as a browser, so MDN's
  operators can identify and rate-limit the crawler if they ever need to.
- **Disallowed paths encountered:** none — `allowPatterns` keeps the crawl
  inside `/en-US/docs/Web/JavaScript`.

## `quotes.toscrape.com` (+ `/js`) — benchmark sandbox only

Used as the controlled target for the scaling benchmark, not as an indexed
content source. Documented for completeness since the benchmark does crawl them.

- **Purpose:** sandbox sites built by Scrapinghub/Zyte *specifically for
  scraping practice* — dummy data, no ToS, no anti-scraping stance. Ideal for a
  scaling benchmark because the crawl target carries no ethical ambiguity and
  the rate cap can be raised safely to make the *queue* (not politeness) the
  bottleneck being measured.
- **robots.txt:** none published (returns 404) — treated as "no restrictions,"
  per RFC 9309 §2.1 (a missing robots.txt means full access is allowed).
- **Rate limit:** 2 req/s (static), 1 req/s (JS-rendered — Playwright page loads
  are heavier on both ends). For the benchmark specifically, the cap is raised
  deliberately (the site is built to be hammered); this is called out in
  `docs/benchmarks.md`.
- **Disallowed paths skipped:** none (nothing disallowed).

## General policy

- Every `Source.ratePerSecond` is enforced by a per-domain Redis token bucket
  (`packages/scraper/rate-limit.ts`), independent of `robots.txt`'s
  `Crawl-delay` — the configured rate is always at least as conservative as
  anything a site publishes. If a site *does* publish a stricter `Crawl-delay`,
  the worker honors the stricter of the two.
- If an origin pushes back (HTTP 429/503), the whole worker fleet opens a shared
  per-domain cooldown honoring `Retry-After` — so backpressure is respected
  fleet-wide, not ignored until jobs fail.
- `packages/scraper/robots.ts` fetches and caches each domain's `robots.txt`
  (24h TTL), and every disallowed URL that would otherwise be enqueued is logged
  and skipped — **regardless of whether `allowPatterns` already excludes it**.
  Defense in depth, not reliance on scope alone. robots.txt fetch failures
  fail *closed* (the URL is skipped), never open.
- No content requiring authentication, payment, or explicit opt-out is crawled
  by any configured source.
