# Distributed RAG-Based Web Scraper

A distributed, fault-tolerant web scraping framework with content versioning, pgvector-backed
semantic search, and RAG question answering with source citations. See [plan.md](./plan.md) for
the full build plan and architecture rationale.

## Repository layout

```
apps/
  api/         Fastify API (search, ask, admin)
  worker/      BullMQ workers (scrape + index)
  web/         Next.js UI (user + admin)
  scheduler/   Cron-style crawl scheduler
packages/
  db/          Prisma schema, client, migrations
  shared/      Zod schemas, types, constants
  scraper/     Crawlee integration, dedup, versioning
  processor/   Readability, Turndown, cleaning pipeline
  rag/         Chunking, embeddings, retrieval, prompts
```

## Prerequisites

- Node.js 22.13+ (pnpm 11 requires it)
- pnpm 11+ (`corepack enable` will pick up the pinned version from `package.json`)
- Docker + Docker Compose

## Local development

```bash
cp .env.example .env       # fill in OPENAI_API_KEY / ANTHROPIC_API_KEY
pnpm install
docker compose up -d postgres redis

# first time only: create the schema
pnpm --filter @scraper/db exec prisma migrate dev

pnpm dev                    # runs all apps via turbo, using local Node rather than containers
```

To run the fully containerized stack instead (API, worker, and web built as Docker images):

```bash
docker compose up --build
```

## Common commands

| Command | Purpose |
|---|---|
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest across the workspace |
| `pnpm build` | Production build of every app/package |
| `pnpm --filter @scraper/db exec prisma studio` | Inspect the database |

## Windows note

`pnpm build` for `apps/web` uses Next.js's `standalone` output, which requires creating symlinks
into `.next/standalone`. On Windows without Developer Mode enabled (Settings → Privacy & security →
For developers), symlink creation needs elevated privileges and the build will fail with `EPERM`. This does not
affect Docker builds (Linux containers) or CI (`ubuntu-latest`) — only a bare-metal `pnpm build`
of `apps/web` on an unelevated Windows shell. Enable Developer Mode, or run `docker compose build
web` instead, to build it locally on Windows.

## Horizontal scaling demo

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up --scale worker=4
```

(added in Phase 7 — see `docs/benchmarks.md` once populated)
