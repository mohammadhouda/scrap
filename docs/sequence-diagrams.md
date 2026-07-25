# Sequence diagrams

The two flows that define the system, at full fidelity — including the
coordination and failure-handling that the higher-level diagrams in
`docs/architecture.md` gloss over. Diagrams are Mermaid (render on GitHub).

- [1. URL lifecycle](#1-url-lifecycle--crawl--clean--index) — a crawl, from
  "Start crawl" to an indexed, searchable page.
- [2. Crash recovery](#2-crash-recovery--the-lost-job-race) — what happens when
  a worker dies mid-flight.
- [3. Ask flow](#3-ask-flow--rag-with-citations) — a question to a cited answer.

---

## 1. URL lifecycle — crawl → clean → index

The path of a single URL through the three queues. The key actors are the
per-crawl **counters in Redis** (`seen` / `enqueued` / `outstanding` /
`settled`) — they, not the queue, are what makes a distributed crawl's progress
and completion observable.

```mermaid
sequenceDiagram
    actor Admin
    participant API as api (Fastify)
    participant R as Redis (queues + counters)
    participant SW as scrape worker
    participant DW as discover worker
    participant IW as index worker
    participant PG as Postgres
    participant AI as OpenAI

    Admin->>API: POST /sources/:id/crawl
    API->>PG: create CrawlRun (RUNNING)
    API->>R: reserveUrlForRun(seed) — SADD seen, INCR outstanding, pagesQueued++
    API->>R: scrape.add(seed, depth 0)
    API-->>Admin: 202 { crawlRunId }

    R->>SW: scrape job
    Note over SW: gauntlet — bail at first "no"
    SW->>R: cancelled? (EXISTS)
    SW->>SW: robots.txt allowed? (cached 24h)
    SW->>R: rate-limit token available?
    alt no token
        SW->>R: moveToDelayed(waitMs) — no retry spent
    else ok
        SW->>SW: fetch (cheerio / Playwright)
        SW->>SW: Readability + Turndown → cleanedMd
        SW->>PG: contentHash == latest version's?
        alt unchanged
            SW->>PG: touch lastSeenAt (no new version)
        else new / changed
            SW->>PG: insert PageVersion (version + 1)
            SW->>R: discover.add(filtered links, parentDepth)
            SW->>R: index.add(pageVersionId)
        end
        SW->>R: settleScrapeForRun — SADD settled, pagesDone++, DECR outstanding
    end

    R->>DW: discover job
    loop each new URL (depth = parentDepth + 1)
        DW->>R: reserveUrlForRun — new? SADD seen, INCR outstanding, pagesQueued++
        DW->>R: scrape.add(url, depth)
        DW->>R: confirmUrlEnqueued — SADD enqueued
    end

    R->>IW: index job
    IW->>PG: load PageVersion; delete previous version's chunks
    IW->>IW: chunk (heading split + recursive, 800/150 tokens)
    IW->>AI: embed chunks (batched)
    IW->>PG: upsert Chunk rows + vectors + tsvector

    Note over SW,PG: when outstanding hits 0, the last settler marks the<br/>CrawlRun SUCCEEDED and reconciles pagesQueued = |seen|
```

**Why depth stops the fan-out:** a scrape job only enqueues a discover job when
`depth < source.maxDepth`, and discover enqueues children at `parentDepth + 1`.
So `maxDepth = 2` reaches pages at depths 0, 1, 2, and depth-2 pages are
crawled but not expanded. See `docs/architecture.md`.

**Invariants enforced here:**
- *Content dedup* — `contentHash = sha256(cleanedMd)` compared to the latest
  version; an unchanged re-crawl writes nothing, only touches `lastSeenAt`.
- *No history loss* — a change is always a new `PageVersion`, never an
  overwrite.
- *Per-run URL dedup* — the `seen` set means a URL is scraped at most once per
  run; `discover` also uses `jobId = scrapeJobId(runId, url)` so concurrent
  duplicate discoveries collapse to one job.

---

## 2. Crash recovery — the lost-job race

The reason `seen` and `enqueued` are **two** sets, not one. A discover worker
reserves a URL (Redis side commits) and then enqueues its scrape job — two
non-atomic steps. A SIGKILL between them would strand the URL: counted, but
never scraped. This is the bug the chaos test found (`docs/benchmarks.md`,
Finding 3) and the recovery that fixes it.

```mermaid
sequenceDiagram
    participant DW as discover worker (dies)
    participant R as Redis
    participant SQ as scrape queue
    participant DW2 as discover worker (retry)

    DW->>R: reserveUrlForRun(U) — SADD seen ✓, INCR outstanding ✓
    Note over DW: 💥 SIGKILL — before scrape.add
    Note over R: U is in `seen`, counted in `outstanding`,<br/>but has NO scrape job and is NOT in `enqueued`

    Note over DW2: BullMQ redelivers the stalled discover job (~30s)
    DW2->>R: reserveUrlForRun(U) — SADD seen returns 0 (already seen)
    R->>DW2: is U in `enqueued`? → NO
    Note over DW2: "seen but not enqueued" = crash gap → return true
    DW2->>SQ: scrape.add(U) — recovered (idempotent via deterministic jobId)
    DW2->>R: confirmUrlEnqueued(U) — SADD enqueued
    Note over R: outstanding was counted once; the recovered scrape<br/>settles it → run finalizes with zero lost jobs
```

A URL is only skipped as a true duplicate when it is in **both** sets. Because
`outstanding` moved on the *first* sighting only, the orphan keeps the run open
(no premature finalize) until the recovered scrape settles. Verified
end-to-end: SIGKILL 1 of 4 workers mid-crawl → 214/214 pages, `settled ==
queued`, zero lost.

---

## 3. Ask flow — RAG with citations

A question becomes a streamed, cited answer. Retrieval is the same hybrid
search the `/search` endpoint exposes; `/ask` adds the LLM synthesis on top.

```mermaid
sequenceDiagram
    actor User
    participant Web as web (/ask page)
    participant API as api (Fastify, SSE)
    participant PG as Postgres (pgvector + FTS)
    participant AI as OpenAI

    User->>Web: type question, submit
    Web->>API: POST /ask { question, source? }  (fetch, not EventSource)
    API->>AI: embed(question)
    par hybrid retrieval
        API->>PG: semantic — pgvector cosine top-k
    and
        API->>PG: keyword — tsvector FTS top-k
    end
    API->>API: Reciprocal Rank Fusion (k=60) → top chunks
    API->>API: buildPrompt — one citation-forcing system prompt<br/>+ numbered [n] sources
    API-->>Web: SSE event: citations  (n, url, title, chunkId, pageId)

    API->>AI: chat.completions (stream)
    loop streamed tokens
        AI-->>API: token (may contain [n] markers)
        API-->>Web: SSE event: token
        Web->>Web: render Markdown; [n] → clickable chip
    end
    API->>API: extractCitedIndices(answer)
    API-->>Web: SSE event: citations-used { indices }
    API-->>Web: SSE event: done
    Web->>Web: split sources into "cited" vs "retrieved but not cited"
```

**The citation guarantee:** the `citations` list is built from the *actual
retrieved chunks* (`toCitations`), before the model writes a word — so a `[n]`
can never point at a URL the model invented. `citations-used` is a
post-processing pass over the finished answer (`extractCitedIndices`) that tells
the UI which sources were actually referenced, so uncited-but-retrieved context
stops masquerading as evidence. What this does **not** guarantee is that the
model *characterized* a cited source correctly — see `docs/limitations.md` #2.

**Why `fetch` + manual SSE, not `EventSource`:** the native `EventSource` API is
GET-only, and `/ask` needs a POST body (the question). The client reads the SSE
stream off a `fetch` response manually (`apps/web/lib/sse.ts`).
