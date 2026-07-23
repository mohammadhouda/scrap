# Distributed RAG-Based Web Scraper

A distributed, fault-tolerant web scraping framework with content
versioning, pgvector-backed hybrid (keyword + semantic) search, and RAG
question answering with source citations — built on independently
scalable BullMQ workers coordinated through Redis.

See [`docs/architecture.md`](docs/architecture.md) for how it fits
together (component diagram, URL lifecycle, indexing/retrieval pipeline,
API reference) and [`plan.md`](plan.md) for the original build plan.

## What it does

1. Crawls multiple sites — static, JS-rendered, and a 500+ page catalog —
   using any number of independent worker containers coordinated through
   shared BullMQ queues (never an in-process, unscalable crawl-framework
   queue). Politeness is enforced twice: proactively (per-domain token
   bucket + robots.txt `Crawl-delay`) and reactively (a 429/503 with
   `Retry-After` opens a shared cooldown the whole fleet honors).
2. Cleans HTML to Markdown, versions every change (nothing is ever
   overwritten), and extracts tables separately.
3. Chunks, embeds (OpenAI `text-embedding-3-small`), and indexes content
   into pgvector.
4. Serves keyword, semantic, and hybrid (Reciprocal Rank Fusion) search,
   plus RAG question answering (GPT-5.5) that streams an answer with
   inline `[n]` citations that always resolve to a real retrieved chunk.
5. Ships a Next.js UI for both end users (search + ask) and operators
   (admin dashboard, queue monitoring, dead-letter-queue retry, version
   diff viewer).

## Repository layout

```
apps/
  api/         Fastify API (search, ask, admin) — REST + SSE
  worker/      BullMQ workers: scrape, discover, index (horizontally scalable)
  web/         Next.js UI (public + admin, App Router)
  scheduler/   Cron-style crawl scheduler
packages/
  db/          Prisma schema, client, migrations (Postgres + pgvector)
  shared/      Zod schemas, types, constants shared across apps
  scraper/     Fetchers (cheerio + shared-Chromium), robots.txt, rate limiting, dedup, versioning
  processor/   Readability + Turndown cleaning pipeline, table extraction
  rag/         Chunking, embeddings, retrieval (keyword/semantic/hybrid), RAG prompt + ask
docker/        Per-app Dockerfiles (multi-stage, via `turbo prune`)
docs/          architecture.md, benchmarks.md, ethics.md, etc. (report material)
```

## Prerequisites

- Node.js 22.13+ (pnpm 11 requires it)
- pnpm 11+ (`corepack enable` picks up the version pinned in `package.json`)
- Docker + Docker Compose
- An OpenAI API key (embeddings + GPT-5.5) — the app starts without one,
  but indexing and `/ask` will fail until it's set

## Running it locally

There are two ways to run this. Pick one.

### Option A — hybrid: Postgres/Redis in Docker, apps on the host (fastest inner loop)

This is the recommended day-to-day setup — no Docker rebuild needed when
you change code.

```bash
cp .env.example .env         # fill in OPENAI_API_KEY, and change ADMIN_TOKEN
pnpm install

docker compose up -d postgres redis

# first time only — creates the schema. Never re-run this against a
# populated DB; see the note below.
pnpm --filter @scraper/db run prisma:migrate

# seeds the 3 demo sources (quotes.toscrape.com static + JS, books.toscrape.com)
pnpm --filter @scraper/db exec prisma db seed

pnpm dev                      # runs api + worker + web + scheduler via turbo
```

This gives you:
- API at **http://localhost:4000** (`API_PORT` in `.env`)
- Web UI at **http://localhost:3000** (`WEB_PORT` in `.env`)
- Admin login token = whatever `ADMIN_TOKEN` is set to in `.env`

> **Windows note:** `pnpm dev`'s `tsx watch` processes and the Prisma CLI
> both need env vars loaded from the root `.env`; every relevant script
> (`api`/`worker`/`scheduler`'s `dev`, and `packages/db`'s `prisma:*`
> scripts) already runs through `dotenv-cli` for you — you don't need to
> export anything manually.
>
> **Never run `prisma migrate dev` against a database that already has
> data in it.** The `embedding` (pgvector) and `content_tsv` (generated
> full-text) columns are added via raw SQL, outside `schema.prisma` (Prisma
> has no native vector type), so `migrate dev`'s drift detection will offer
> to **drop both columns** — silently destroying every embedding. Applying
> already-checked-in migrations should always go through
> `pnpm --filter @scraper/db run prisma:deploy` instead.

### Option B — fully containerized stack

Everything, including the apps, runs in Docker. Slower to iterate against
(needs a rebuild on every code change) but closest to production/what the
grader will run.

```bash
cp .env.example .env         # fill in OPENAI_API_KEY, and change ADMIN_TOKEN
docker compose up --build
```

A one-shot `migrate` service applies the checked-in migrations and seeds the
demo sources before `api`/`worker` start, so this works from a fresh clone
with no manual DB step. Seeding only happens on an **empty** database —
restarting the stack never wipes crawled data.

Same ports as above (`localhost:4000`, `localhost:3000`); Postgres/Redis
are not exposed to any extra tooling beyond what's in `docker-compose.yml`.

### Horizontal scaling demo

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up --scale worker=4

# measure a crawl (pages/sec + lost-job check):
pnpm --filter @scraper/worker run bench quotes-static

# chaos test: SIGKILL a worker mid-crawl, watch the others absorb its jobs:
./scripts/kill-worker.sh
```

See [`docs/benchmarks.md`](docs/benchmarks.md) for the methodology (including
why single-domain throughput is rate-limit-bound by design) and the measured
results table.

## Common commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run every app locally via Turborepo (needs Postgres/Redis reachable — see Option A) |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest across the workspace |
| `pnpm build` | Production build of every app/package |
| `pnpm --filter @scraper/db run prisma:studio` | Browse the database (Prisma Studio) |
| `pnpm --filter @scraper/db run prisma:deploy` | Apply checked-in migrations (safe, no drift diff) |
| `pnpm --filter @scraper/api exec vitest run` | Run just the API's test suite |
| `pnpm --filter @scraper/worker run crawl` | Manually enqueue a crawl (see `apps/worker/src/scripts`) |

CI (`.github/workflows/ci.yml`) runs install → lint → typecheck → test →
build on every push/PR, on `ubuntu-latest`.

## Environment variables

See [`.env.example`](.env.example) for the full list. The two that trip
people up:

- `DATABASE_URL` / `REDIS_URL` — these are **host-facing** values
  (`localhost:5432` / `localhost:6379`) used by Prisma CLI and `pnpm dev`.
  The fully-containerized stack (`docker-compose.yml`) does **not** read
  these from `.env` — it hardcodes the Docker-internal hostnames
  (`postgres`, `redis`) directly for the `api`/`worker` services, since
  containers can't resolve `localhost` to each other.
- `ADMIN_TOKEN` — protects every `/admin/*` route and the admin UI.
  `.env.example` ships a `change-me` placeholder; **set a real value in
  your own `.env`**, which is gitignored.

## Testing strategy

- **Unit** — chunking, dedup, robots parsing, citation extraction, rate
  limiting, RRF fusion (`*.test.ts` next to the source file in every
  package).
- **API** — Vitest + Fastify's `inject()` against a mocked Prisma client
  (`apps/api/src/app.test.ts`).
- **Integration** (worker) — BullMQ job handlers tested directly against
  their processing functions.

CI runs the full suite (no live OpenAI/network calls — those are mocked)
on every push.

## Windows-specific notes

- `pnpm build` for `apps/web` uses Next.js's `standalone` output, which
  needs symlinks into `.next/standalone`. Without Developer Mode enabled
  (Settings → Privacy & security → For developers), that build step fails
  with `EPERM`. Doesn't affect Docker builds (Linux containers) or CI. Fix:
  enable Developer Mode, or build via `docker compose build web`.
- If `prisma generate` fails with `EPERM ... rename ...
  query_engine-windows.dll.node`, it's almost always VS Code's TypeScript/
  Prisma language server holding the file open — close the relevant editor
  tab or restart the language server. Doesn't affect Linux (Docker/CI).

## Target sites

| Source | Type | Notes |
|---|---|---|
| `quotes.toscrape.com` | Static | sandbox site, purpose-built for scraping practice — no robots.txt/ToS ambiguity |
| `quotes.toscrape.com/js` | JS-rendered | sandbox site; forces the Playwright fetch path |
| `developer.mozilla.org/en-US/docs/Web/JavaScript` | 500+ pages | real technical reference content (headings, code blocks, tables); robots.txt allows crawling, CC-BY-SA licensed |

See [`docs/ethics.md`](docs/ethics.md) for the full robots.txt/rate-limit
review.
