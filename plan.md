# Distributed RAG-Based Web Scraper — Build Plan

> **For:** Claude Code
> **Owner:** Mo
> **Context:** University final assignment. Grade depends on architecture quality, distribution story, RAG quality, and the written report as much as on working code. Build with that in mind.

---

## 1. What we're building

A distributed, fault-tolerant web scraping framework that:

1. Crawls 3+ websites (one static, one JS-rendered, one with 500+ pages) using multiple independent worker containers coordinated through a shared job queue.
2. Cleans, versions, and stores the scraped content in Postgres.
3. Chunks, embeds, and indexes content in pgvector.
4. Exposes an API for raw retrieval, keyword search, semantic search, and RAG-based question answering with source citations.
5. Ships a Next.js UI with two audiences: end user (search + ask) and operator (admin dashboard + queue monitoring + DLQ).
6. Demonstrates horizontal scaling and graceful failure recovery.

---

## 2. Tech stack (locked)

| Concern | Choice | One-line rationale |
|---|---|---|
| Language | TypeScript + Node.js 20 | Async I/O suits scraping; unifies scraper/API/UI in one language. |
| Package manager | pnpm | Fast, workspace-native. |
| Monorepo | pnpm workspaces + Turborepo | Simple, no Nx overhead. |
| Queue | BullMQ on Redis 7 | Built-in rate limiting, retries, delayed jobs, DLQ via failed state. |
| Scraper engine | Crawlee (Cheerio + Playwright crawlers) | Unified API for static + JS; robots, sessions, retries built-in. |
| Main-content extraction | `@mozilla/readability` + `jsdom` | Battle-tested boilerplate stripping. |
| HTML → Markdown | `turndown` + `turndown-plugin-gfm` | Preserves headings/tables/lists as structure for chunking. |
| DB | PostgreSQL 16 + Prisma | Familiar, versioning is easy with SQL. |
| Vector store | `pgvector` on the same Postgres | One DB, less ops overhead. Justify vs Qdrant in report. |
| Chunking | `langchain/text_splitter` (Markdown-header + recursive character) | Standard, well-documented, structurally aware. |
| Embeddings | OpenAI `text-embedding-3-small` | Cheap, strong. 1536-dim. |
| LLM | Anthropic Claude Sonnet 4.5 | Good citation adherence; matches Mo's existing stack. |
| API | Fastify | Faster than Express, TS-native, low ceremony. |
| Validation | Zod | Runtime + type-level. |
| UI | Next.js 15 (App Router) + Tailwind + shadcn/ui | SSR search + streaming answers. |
| Container | Docker + Docker Compose | Standard. |
| CI | GitHub Actions | Lint, typecheck, test, build. |
| Test | Vitest + Supertest | Fast, TS-native. |

**Alternatives to name in the report (each with why-not):** Puppeteer (Crawlee wraps Playwright which is superior), Scrapy/Python (would split language), RabbitMQ (more ops overhead for equivalent value), Qdrant (adds a service; pgvector suffices at this scale), NestJS (more ceremony than needed), Pinecone (paid, SaaS lock-in).

---

## 3. Repository layout

```
distributed-rag-scraper/
├── apps/
│   ├── api/                 # Fastify server
│   ├── worker/              # BullMQ workers (scrape + index)
│   ├── web/                 # Next.js UI (user + admin)
│   └── scheduler/           # Cron-style crawl scheduler (small, optional in phase 1)
├── packages/
│   ├── db/                  # Prisma schema, client, migrations
│   ├── shared/              # Zod schemas, types, constants
│   ├── scraper/             # Crawlee integration, dedup, versioning
│   ├── processor/           # Readability, Turndown, cleaning pipeline
│   └── rag/                 # Chunking, embeddings, retrieval, prompts
├── docker/
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   └── Dockerfile.web
├── docker-compose.yml
├── docker-compose.scale.yml  # Overrides for horizontal scaling demo
├── .github/workflows/ci.yml
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── README.md
└── docs/
    ├── architecture.md      # For the report
    ├── sequence-diagrams.md
    ├── benchmarks.md
    └── ethics.md
```

---

## 4. Data model (Prisma)

```prisma
model Source {
  id            String   @id @default(cuid())
  name          String   @unique             // "hackernews", "mdn", "jobboard"
  seedUrl       String
  allowPatterns String[]                     // regex allowlist
  denyPatterns  String[]
  renderJs      Boolean  @default(false)
  maxDepth      Int      @default(3)
  ratePerSecond Float    @default(1.0)       // per-domain politeness
  scheduleCron  String?
  createdAt     DateTime @default(now())
  pages         Page[]
  crawls        CrawlRun[]
}

model CrawlRun {
  id           String   @id @default(cuid())
  sourceId     String
  source       Source   @relation(fields: [sourceId], references: [id])
  startedAt    DateTime @default(now())
  finishedAt   DateTime?
  status       CrawlStatus @default(RUNNING)
  pagesQueued  Int      @default(0)
  pagesDone    Int      @default(0)
  pagesFailed  Int      @default(0)
}

enum CrawlStatus { RUNNING SUCCEEDED FAILED CANCELLED }

model Page {
  id           String   @id @default(cuid())
  sourceId     String
  source       Source   @relation(fields: [sourceId], references: [id])
  url          String   @unique
  urlHash      String                        // sha256(url), indexed for dedup lookup
  firstSeenAt  DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  versions     PageVersion[]

  @@index([sourceId])
  @@index([urlHash])
}

model PageVersion {
  id            String   @id @default(cuid())
  pageId        String
  page          Page     @relation(fields: [pageId], references: [id])
  version       Int
  contentHash   String                       // sha256(cleaned markdown)
  rawHtml       String   @db.Text
  cleanedMd     String   @db.Text
  title         String?
  language      String?
  tables        Json?                        // extracted tables as JSON
  fetchedAt     DateTime @default(now())
  chunks        Chunk[]

  @@unique([pageId, version])
  @@index([contentHash])
}

model Chunk {
  id             String   @id @default(cuid())
  pageVersionId  String
  pageVersion    PageVersion @relation(fields: [pageVersionId], references: [id], onDelete: Cascade)
  index          Int                         // ordinal within the page
  heading        String?                     // nearest H1/H2/H3
  content        String   @db.Text
  contentType    ChunkType @default(PROSE)
  tokenCount     Int
  // embedding stored via raw SQL (pgvector): vector(1536)

  @@index([pageVersionId])
}

enum ChunkType { PROSE TABLE CODE LIST }
```

**Vector column:** add via migration —
```sql
ALTER TABLE "Chunk" ADD COLUMN embedding vector(1536);
CREATE INDEX ON "Chunk" USING hnsw (embedding vector_cosine_ops);
```

**Full-text search:** add a generated tsvector column on `Chunk.content` with a GIN index for the keyword search path.

---

## 5. Environment variables

```
# .env.example
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/scraper
REDIS_URL=redis://redis:6379
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small
LLM_MODEL=claude-sonnet-4-5
API_PORT=4000
WEB_PORT=3000
WORKER_CONCURRENCY=5
ADMIN_TOKEN=change-me
```

---

## 6. Build phases

Each phase must end in a commit that passes CI. Do not proceed until acceptance criteria are met.

### Phase 0 — Foundation

- [ ] Initialize pnpm workspaces, Turborepo, TS project references
- [ ] Set up ESLint + Prettier + Vitest
- [ ] Create the folder layout in section 3
- [ ] Prisma schema from section 4, initial migration
- [ ] Add pgvector extension in a follow-up migration
- [ ] `docker-compose.yml` with services: `postgres`, `redis`, `api`, `worker`, `web`
- [ ] `Dockerfile`s per app, multi-stage builds
- [ ] `.github/workflows/ci.yml` running: install → lint → typecheck → test → build
- [ ] `README.md` with local dev instructions

**Acceptance:** `docker compose up` starts all services; `pnpm test` passes on a smoke test.

### Phase 1 — Scraping

The key integration decision: **BullMQ owns the distributed queue; Crawlee is used per-worker as the fetcher/parser.** Do not use Crawlee's internal `RequestQueue` for coordination — that breaks the distributed story.

**Queues:**
- `scrape` — one job = one URL to fetch
- `index` — one job = one PageVersion to embed
- `discover` — one job = a batch of newly discovered URLs to enqueue after allow/deny filtering

**Worker shape (`apps/worker`):**

```ts
// pseudocode
const scrapeWorker = new Worker('scrape', async (job) => {
  const { url, sourceId } = job.data;
  const source = await db.source.findUnique({ where: { id: sourceId } });

  // robots check (cached per-domain)
  if (!await robots.isAllowed(url)) return { skipped: 'robots' };

  // rate limit gate (BullMQ rate limiter, keyed by domain)

  // fetch via Crawlee — pick crawler based on source.renderJs
  const result = source.renderJs
    ? await playwrightFetch(url)
    : await cheerioFetch(url);

  // dedup: compare content hash against latest PageVersion
  const contentHash = sha256(result.cleanedMdPreview);
  const latest = await getLatestVersion(url);
  if (latest?.contentHash === contentHash) {
    await touchLastSeen(url);
    return { unchanged: true };
  }

  // persist raw + cleaned + tables as new PageVersion (bump version)
  const pageVersion = await persistVersion(url, sourceId, result);

  // enqueue discovered links (filtered)
  await discoverQueue.add('links', {
    sourceId,
    urls: filterLinks(result.discoveredLinks, source),
    parentDepth: job.data.depth,
  });

  // enqueue indexing
  await indexQueue.add('index', { pageVersionId: pageVersion.id });

  return { versioned: pageVersion.version };
}, {
  connection: redis,
  concurrency: WORKER_CONCURRENCY,
  limiter: { max: 10, duration: 1000 }, // baseline; per-domain enforced separately
});
```

**Tasks:**
- [ ] `packages/scraper/robots.ts` — cached robots.txt parser with per-domain TTL
- [ ] `packages/scraper/rate-limit.ts` — token bucket keyed by domain, Redis-backed
- [ ] `packages/scraper/cheerio-fetch.ts` — undici + cheerio, returns `{ html, discoveredLinks, meta }`
- [ ] `packages/scraper/playwright-fetch.ts` — Crawlee's PlaywrightCrawler in single-request mode
- [ ] `packages/scraper/dedup.ts` — sha256 helpers for URL and content
- [ ] `packages/scraper/versioning.ts` — persist logic that bumps version number
- [ ] Retry policy on jobs: 5 attempts, exponential backoff (2s → 32s)
- [ ] DLQ: BullMQ auto-marks failed jobs after max attempts; expose them via admin API
- [ ] Seed script: register the 3 target sources (see section 12)

**Acceptance:** Run against Site 1, see PageVersions accumulate with version=1. Re-run, see either unchanged skips or version=2 rows.

### Phase 2 — Processing

- [ ] `packages/processor/clean.ts` — `rawHtml → readability → turndown → cleanedMarkdown`
- [ ] `packages/processor/tables.ts` — extract HTML tables with Cheerio, convert to array-of-objects JSON, store in `PageVersion.tables`
- [ ] `packages/processor/language.ts` — detect language (franc or similar), store on PageVersion
- [ ] Zod schemas in `packages/shared/schemas` validating processed output before DB write

**Acceptance:** Every stored PageVersion has non-empty `cleanedMd`, correct title, and tables extracted where present.

### Phase 3 — Indexing (RAG index side)

**Chunking pipeline** in `packages/rag/chunk.ts`:

```
cleanedMarkdown
  → MarkdownHeaderTextSplitter (split on #, ##, ###, retain heading as metadata)
  → per-section: RecursiveCharacterTextSplitter (chunkSize=800 tokens, overlap=150)
  → attach metadata: { sourceUrl, pageTitle, heading, chunkIndex, version, contentHash }
  → tables passed through as their own chunks with a synthesized caption line prepended
```

- [ ] `packages/rag/chunk.ts` — the pipeline above
- [ ] `packages/rag/embed.ts` — batched OpenAI embeddings (batch size 100, retry on 429)
- [ ] `apps/worker/index-worker.ts` — consumes `index` queue: chunk → embed → upsert to `Chunk` with pgvector
- [ ] On re-index (new PageVersion): delete old chunks for the previous version via cascade; index the new version

**Acceptance:** Query `SELECT count(*) FROM "Chunk"` grows in proportion to PageVersions. HNSW index exists.

### Phase 4 — Retrieval + RAG

- [ ] `packages/rag/retrieve.ts` — semantic top-k with pgvector cosine similarity, optional source filter
- [ ] `packages/rag/keyword.ts` — Postgres FTS ranking on the tsvector column
- [ ] `packages/rag/hybrid.ts` — reciprocal rank fusion of semantic + keyword (mention in report)
- [ ] `packages/rag/prompt.ts` — the citation-forcing prompt:

```
System: You answer questions using ONLY the provided sources. Cite every claim
with [n] where n is the source index. If the sources do not contain the answer,
say so. Do not invent sources or facts.

User: <question>

Sources:
[1] URL: ... | Title: ... | Heading: ...
<chunk content>

[2] ...
```

- [ ] `packages/rag/ask.ts` — orchestrator: retrieve → prompt → stream from Claude → parse citations → return `{ answerStream, citations: [{ n, url, title, chunkId }] }`
- [ ] Multi-source synthesis test: seed a question whose answer requires chunks from 2+ sites; assert both appear in citations.

**Acceptance:** `/ask` returns an answer with at least one `[n]` per non-trivial claim, and the cited URLs are real.

### Phase 5 — API (Fastify)

Routes:

| Method | Path | Purpose |
|---|---|---|
| GET | `/sources` | List configured sources |
| POST | `/sources` | Create source (admin) |
| POST | `/sources/:id/crawl` | Start a crawl run (admin) |
| GET | `/pages` | Paginated raw pages, filter by source |
| GET | `/pages/:id/versions` | Version history for a page |
| GET | `/search?q=&mode=keyword\|semantic\|hybrid&source=` | Search endpoint |
| POST | `/ask` | RAG Q&A, streams SSE |
| GET | `/admin/queues` | Counters + recent jobs (auth: ADMIN_TOKEN) |
| GET | `/admin/dlq` | Failed jobs (auth) |
| POST | `/admin/dlq/:id/retry` | Requeue a failed job (auth) |
| GET | `/health` | Liveness |
| GET | `/metrics` | Prometheus format (optional stretch) |

- [ ] Zod validation on every route
- [ ] SSE streaming on `/ask`
- [ ] Admin routes gated by bearer token
- [ ] OpenAPI schema auto-generated via `@fastify/swagger`

**Acceptance:** All routes return sensible responses; SSE stream is clean; admin routes 401 without token.

### Phase 6 — UI (Next.js)

Public routes:
- `/` — landing with search bar, source cards showing page counts + last crawl time
- `/search` — results list, keyword/semantic toggle, filters sidebar
- `/ask` — question input, streaming answer with `[n]` citation chips, sources panel
- `/page/[id]` — cached page snapshot with highlighted chunk

Admin routes (behind `ADMIN_TOKEN` cookie, simple gate):
- `/admin` — dashboard, live queue counters (polling every 2s or WS)
- `/admin/sources` — CRUD for sources, "Start crawl" button
- `/admin/dlq` — failed jobs table, retry/discard actions
- `/admin/pages/[id]/diffs` — version diff viewer (diff-match-patch or similar)

- [ ] Tailwind + shadcn/ui components (Button, Card, Input, Table, Tabs, Badge)
- [ ] Use `EventSource` for `/ask` streaming
- [ ] Citation chips resolve to `/page/[id]?chunk=[n]` with anchor scroll + highlight
- [ ] Loading, empty, and error states on every data-fetching page

**Acceptance:** All flows described in section 3 of the user journey work end-to-end.

### Phase 7 — Fault tolerance + horizontal scaling demo

This exists specifically for the video and report.

- [ ] `docker-compose.scale.yml` — `docker compose up --scale worker=4`
- [ ] Benchmark script: `scripts/bench.ts` — enqueue N URLs against a controlled fixture site, measure wall-clock with 1 vs 2 vs 4 workers, output a CSV
- [ ] Chaos script: `scripts/kill-worker.sh` — kills one worker container mid-crawl; verify in-flight jobs redistribute and DLQ stays empty for transient failures
- [ ] Document results in `docs/benchmarks.md`

**Acceptance:** Benchmark shows near-linear speedup (>3x with 4 workers vs 1); chaos test shows zero lost jobs.

### Phase 8 — Report, diagrams, video

- [ ] `docs/architecture.md` — component diagram (Mermaid or Excalidraw export)
- [ ] `docs/sequence-diagrams.md` — the URL-lifecycle and ask-flow sequences from section 3 of user journey
- [ ] `docs/ethics.md` — for each of the 3 target sites: robots.txt status, ToS review, rate limit chosen, contact info if disallowed sections were skipped
- [ ] `docs/tech-justifications.md` — every choice from section 2 with one considered alternative
- [ ] `docs/chunking-strategy.md` — the table from section 5 of chunking discussion, expanded
- [ ] Video script outline in `docs/video-script.md`
- [ ] Record 10–15 min video: intro → architecture → live scrape → search demo → ask demo → fault tolerance demo → scaling benchmark → wrap

---

## 7. Non-obvious implementation details

### Crawlee + BullMQ integration

Crawlee is used as the **fetcher/parser inside a single BullMQ worker invocation**, not as the coordinator. Concretely:

```ts
async function playwrightFetch(url: string) {
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    requestHandler: async ({ page, request, enqueueLinks }) => {
      await page.waitForLoadState('networkidle');
      const html = await page.content();
      const links = await page.$$eval('a[href]', as => as.map(a => (a as HTMLAnchorElement).href));
      request.userData.result = { html, discoveredLinks: links, title: await page.title() };
    },
  });
  const request = new Request({ url });
  await crawler.run([request]);
  return request.userData.result;
}
```

Discovered links are handed to BullMQ, not Crawlee's `RequestQueue`. This keeps the coordination distributed.

### Per-domain rate limiting

BullMQ's built-in limiter is global. For per-domain politeness, wrap the fetch in a Redis-backed token bucket keyed by domain:

```
key: ratelimit:{domain}
```

Refill rate = `source.ratePerSecond`. Block (with a short async wait) until a token is available before fetching.

### Dedup logic

- **URL dedup:** on `Page.urlHash` unique constraint. Discovered links check existence before enqueueing.
- **Content dedup:** SHA-256 of `cleanedMd` compared against latest `PageVersion.contentHash`. Match → skip write, only touch `lastSeenAt`.

### DLQ pattern

BullMQ marks jobs `failed` after max attempts. Query with `queue.getFailed(0, 100)`. Admin UI lists these; retry re-enqueues; discard uses `job.remove()`.

### Citation extraction

Prompt the LLM to output `[n]` inline. Post-process the streamed answer to extract citation numbers and map back to the retrieved chunk list. Include the map in the API response so the UI can render chips.

### Robots.txt compliance

- Fetch `/robots.txt` once per domain, cache for 24h in Redis
- Use `robots-parser` npm package
- Respect `Crawl-delay` if present (raise the domain's rate limit accordingly)
- Log every disallowed URL skipped, for the ethics report

---

## 8. Target sites (candidates)

Pick three that you've verified against robots.txt. Suggested set:

1. **Static** — `en.wikipedia.org` (specific category tree; respects a low rate limit)
2. **JS-rendered** — a public SPA docs site (e.g., a Vercel/Next-powered docs portal) that renders content client-side
3. **500+ pages** — `news.ycombinator.com` archive pages (pagination), or `arxiv.org` listing pages (be very polite: 1 req/3s)

Document ToS review and rate-limit rationale for each in `docs/ethics.md`.

---

## 9. Testing strategy

- **Unit:** chunking, dedup, robots parsing, citation extraction, rate limiter
- **Integration:** worker end-to-end against a local fixture HTTP server (spin one up in tests) — asserts DB rows, queue transitions
- **API:** Supertest against Fastify instance with a test DB
- **E2E (light):** Playwright test that hits the Next.js UI, runs a search, gets results

CI runs all except E2E on every push. E2E on tags only.

---

## 10. Deliverables checklist (assignment mapping)

- [ ] Source code (all `apps/*` and `packages/*`)
- [ ] `docker-compose.yml` reproducing the full system locally
- [ ] Sample crawl data (a small export in `samples/`)
- [ ] CI pipeline green in `.github/workflows/ci.yml`
- [ ] `docs/architecture.md` with component diagram
- [ ] `docs/sequence-diagrams.md` with the URL-lifecycle + ask-flow diagrams
- [ ] `docs/tech-justifications.md`
- [ ] `docs/ethics.md`
- [ ] `docs/chunking-strategy.md`
- [ ] `docs/benchmarks.md` with scaling results
- [ ] Video recording (10–15 min) at `docs/video.md` (link)
- [ ] Written report combining the above into a single PDF/markdown

---

## 11. Constraints and reminders

- Every worker container must be independently killable without data loss.
- Never overwrite a PageVersion silently — always bump version and keep history.
- Never let a citation `[n]` point to a URL not in the retrieval set.
- Every LLM prompt goes through a single `packages/rag/prompt.ts` — no ad-hoc prompts in route handlers.
- All external I/O (LLM, embeddings, Redis, DB) wrapped in retry-with-backoff.
- No secrets committed; `.env.example` only.
- Commit granularly with meaningful messages. The grader may inspect commit history.

---

## 12. Suggested build order for Claude Code sessions

1. Phase 0 in one session — leave with green CI and running Docker Compose.
2. Phase 1 in two sessions — split at "single-URL fetch works" vs "distributed queue + retries + DLQ".
3. Phase 2 + Phase 3 in one session — they're small and tightly coupled.
4. Phase 4 in one session — get citations working end-to-end before UI.
5. Phase 5 in one session.
6. Phase 6 in two sessions — public UI, then admin.
7. Phase 7 in one session.
8. Phase 8 (docs + video) done manually, not by Claude Code.

Do not skip ahead. Each phase's acceptance criteria must be met before the next starts.