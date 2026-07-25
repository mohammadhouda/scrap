# Technology justifications

Every significant technology choice, the leading alternative that was
considered, and why this one was picked. The theme throughout: **minimize the
number of moving services and languages**, because the hard part of this
project is the *distribution and RAG story*, not the infrastructure — every
extra service is ops surface that doesn't earn its keep at this scale.

## At a glance

| Concern | Choice | Considered alternative | Why this over that |
|---|---|---|---|
| Language | TypeScript / Node 22 | Python (Scrapy) | One language across scraper, API, and UI; async I/O suits scraping. Python would split the stack in two. |
| Monorepo | pnpm workspaces + Turborepo | Nx | Turborepo is lighter and config-minimal; Nx's generators/plugins are more than this repo needs. |
| Job queue | BullMQ on Redis | RabbitMQ / Kafka | Batteries-included retries, backoff, rate limiting, DLQ, delayed jobs — and Redis is already needed for coordination. RabbitMQ/Kafka add a broker to run for no extra value here. |
| Scraper | Crawlee (Cheerio + Playwright) | Puppeteer / raw fetch | One API for static *and* JS pages, with robots/session/retry plumbing. Used as a per-job fetcher only (see below). |
| Content extraction | Readability + Turndown | Custom DOM rules / `unstructured` | Battle-tested boilerplate stripping + structure-preserving Markdown, for far less code than hand-rolled rules. |
| Database | PostgreSQL 16 + Prisma | MySQL / MongoDB | Relational versioning is natural in SQL; Prisma gives typed access. Mongo would make the version/relation model awkward. |
| Vector store | pgvector (same Postgres) | Qdrant / Pinecone / Weaviate | One database instead of two. HNSW + cosine is plenty at this scale (see below). |
| Embeddings | OpenAI `text-embedding-3-small` | Local sentence-transformers | Strong, cheap (1536-dim), zero infra. A local model adds a GPU/serving concern for marginal quality gain. |
| LLM | OpenAI GPT-5.5 (+ 5.5-mini) | Anthropic Claude / local Llama | Good citation adherence; one provider for embeddings *and* chat simplifies ops and auth. |
| Chunking | LangChain textsplitters + js-tiktoken | Hand-rolled / semantic chunker | Standard, structure-aware splitting with real token counting; an LLM-driven chunker costs money/latency for unproven gain. |
| API | Fastify | Express / NestJS | Fast, TS-native, low ceremony; schema-first with Zod. NestJS adds decorators/DI this app doesn't need. |
| Validation | Zod | Joi / io-ts | One schema drives runtime validation, TS types, *and* the OpenAPI doc (`fastify-type-provider-zod`). |
| UI | Next.js 15 (App Router) + Tailwind | Vite + React SPA / Remix | SSR search + streaming answers + server actions in one framework; a SPA would need a separate BFF for the httpOnly-cookie admin auth. |
| Containers | Docker + Compose | Kubernetes | Compose reproduces the whole stack in one file and scales workers with `--scale`. K8s is overkill for a single-host demo. |
| CI | GitHub Actions | CircleCI / GitLab CI | Free for the repo, zero setup, standard. |
| Tests | Vitest | Jest | Faster, native ESM/TS, same API. Jest's ESM story is still friction. |

## The three decisions that shaped the architecture

### 1. BullMQ owns coordination; Crawlee is only a fetcher

This is *the* distribution decision. Crawlee ships its own in-process
`RequestQueue`, and the tempting path is to let Crawlee crawl. But that queue
lives inside one process — it can't coordinate work across containers, so a
Crawlee-coordinated crawler cannot scale horizontally, which is the entire
point of the assignment.

Instead, **BullMQ (on Redis) owns all cross-worker coordination** — the
`scrape` / `discover` / `index` queues, retries, backoff, the dead-letter
queue, and the per-crawl counters. Crawlee is demoted to a per-job fetcher:
one `scrape` job fetches exactly one URL and hands discovered links *back to
BullMQ*, never to Crawlee's own queue. That single boundary is what makes
"run 4 workers, kill one, lose nothing" true (verified — `docs/benchmarks.md`).

*Alternative considered:* Scrapy + scrapy-redis (distributed Scrapy). Rejected
because it splits the codebase into a second language and its distribution
model is less transparent than an explicit BullMQ queue we control end to end.

### 2. pgvector, not a dedicated vector database

A dedicated vector DB (Qdrant, Weaviate, Pinecone) is the "obvious" RAG choice,
but each is *another service to run, secure, back up, and keep in sync with the
source-of-truth relational data*. pgvector puts the vectors in the **same
Postgres** that already holds sources, pages, versions, and chunks — so:

- a chunk and its embedding are one row, updated in one transaction (no
  dual-write drift between a SQL store and a vector store);
- hybrid search is a single database away — the keyword path (`tsvector` + GIN)
  and the semantic path (`vector` + HNSW) live side by side and fuse in one
  place;
- one fewer service in `docker-compose.yml`.

The trade-off is scale: a purpose-built vector DB wins at hundreds of millions
of vectors with heavy filtered search. At this project's scale (tens of
thousands of chunks) pgvector's HNSW index is comfortably fast, and the
operational simplicity is worth far more than the headroom. *If* the corpus
grew past pgvector's comfortable range, the retrieval layer
(`packages/rag`) is the only thing that would need to change — the crawl and
storage model wouldn't.

### 3. One OpenAI provider for both embeddings and generation

Embeddings and the chat model come from the same provider, so there's one API
key, one SDK, one failure mode to wrap in retries (`packages/rag/src/openai-fetch.ts`).
Mixing providers (e.g. local embeddings + a hosted LLM) would double the auth,
error-handling, and cost-tracking surface. GPT-5.5 was chosen over alternatives
specifically for **citation adherence** — the whole product hinges on the model
respecting "cite every claim with `[n]`, don't invent sources," and a model
that ignores that instruction breaks the core guarantee.

*Note:* the abstraction is thin — `createEmbedder` / `createAsker` take the
model and key as options, so swapping providers is a localized change, not a
rewrite.

## Honest counterpoints

- **pgvector** will eventually be outgrown by a corpus that a dedicated vector
  DB handles better; this is a scale bet, not a claim that pgvector is always
  right.
- **A hosted LLM** means answers cost money and have variable latency
  (`docs/limitations.md` #6); a local model would trade that for serving
  infrastructure and (likely) weaker citation behavior.
- **Compose, not Kubernetes**, means the "horizontal scaling" story is
  single-host (`--scale worker=N`), not multi-node. That's the right scope for
  a demo, but it's a demo of the *pattern*, not a production cluster.

See `docs/architecture.md` for how these pieces fit together and
`docs/limitations.md` for where the choices show their edges.
