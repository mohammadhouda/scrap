# Chunking strategy

How a cleaned page becomes the embedded, searchable units the RAG pipeline
retrieves. The implementation is `packages/rag/src/chunk.ts`; this document
explains *what* it does and *why* each decision was made.

## The problem chunking solves

An embedding model turns a span of text into one vector. Too large a span and
the vector becomes a blurry average that matches everything weakly; too small
and it loses the context that makes it meaningful. Chunking is the act of
cutting a page into spans that are each **coherent enough to answer a question
on their own** and **small enough to embed sharply** — while staying under the
model's hard input limit (`text-embedding-3-small` caps at 8191 tokens).

## Parameters (and why)

| Parameter | Value | Rationale |
|---|---|---|
| Chunk size | **800 tokens** | Big enough to hold a full concept (a method's description + signature + a note); small enough that the vector stays specific. |
| Overlap | **150 tokens** | ~19% overlap so a fact split across a boundary still lands whole in at least one chunk — the classic fix for "the answer was cut in half." |
| Token counter | **`js-tiktoken`, `cl100k_base`** | Sizes are measured in *real* tokens, not characters. A character budget over-/under-shoots wildly on code-heavy pages (MDN); token counting keeps every chunk a uniform embedding cost. |
| Table chunk cap | **800 tokens** | Tables bypass the recursive splitter, so they're capped explicitly — one giant table would otherwise become a single chunk that blows the 8191-token embed limit and fails the whole index job. |

## The pipeline

```
cleaned Markdown
  │
  ├─ (A) split on Markdown headings (#, ##, ###) — fence-aware
  │        → sections, each tagged with its nearest heading
  │
  ├─ (B) per section: recursive character split (markdown-aware,
  │        800 tokens / 150 overlap, token-length-measured)
  │        → PROSE chunks, each carrying its section heading
  │
  └─ (C) extracted tables (from PageVersion.tables, structured JSON)
           → serialized "key: value" rows, packed into ≤800-token
             TABLE chunks with a repeated caption
  ↓
  concatenate → assign a page-ordinal `index` to each chunk
```

### (A) Heading split — hand-rolled and fence-aware

JavaScript LangChain doesn't ship a `MarkdownHeaderTextSplitter` that retains
per-section heading metadata (the Python one does), so this is hand-written.
The heading is kept as chunk metadata because it's valuable retrieval signal —
"Return value" under `Array.prototype.findIndex` means something the raw
sentence doesn't — and it's surfaced to the LLM in the prompt (`Heading: …`).

The non-obvious part: it **tracks fenced code blocks**. A line like
`# create a counter` *inside* a ```` ``` ```` fence is a code comment, not a
Markdown heading. Without fence tracking, a code-heavy page (MDN is nothing
but code samples) would split mid-example and mislabel headings. The splitter
records the opening fence marker and only treats `#`/`##`/`###` as a heading
when it's *outside* a fence.

### (B) Recursive character split within a section

Each section's body goes through LangChain's
`RecursiveCharacterTextSplitter.fromLanguage('markdown', …)`. "Recursive" means
it tries to split on the *largest* natural boundary first (paragraphs), then
progressively finer ones (sentences, then words) only as needed to fit the
800-token budget — so chunks break at semantically sensible places rather than
mid-sentence. The `markdown` language preset knows about Markdown separators
(headings, list markers, code fences). Crucially, `lengthFunction` is the
tiktoken counter, so the 800/150 budget is enforced in **tokens, not
characters**.

### (C) Tables as their own chunks

Tables are extracted upstream (`packages/processor/tables.ts`) into structured
JSON and stored on `PageVersion.tables`, deliberately *not* left inline in the
Markdown (Turndown mangles them). At chunk time each table row is serialized to
a compact `key: value, key: value` line, and rows are **packed** into chunks
that stay under the 800-token cap, with the caption (`Table (<page title>):`)
**repeated on every chunk** so each table chunk is self-describing even when a
big table spans several. These become `ChunkType.TABLE` chunks — which is why a
question like "how many copies are in stock?" can retrieve a product's
info-table row directly.

Chunk content types are tracked (`PROSE | TABLE | CODE | LIST`) so the UI can
render each appropriately (e.g. the page snapshot shows TABLE chunks
monospaced) and so future retrieval could weight or filter by type.

## What each chunk carries

Every chunk is stored (`packages/rag/src/store.ts`) with:

- `index` — its ordinal position on the page (stable ordering for display),
- `heading` — the nearest H1/H2/H3 (metadata + prompt context),
- `content` — the text that gets embedded,
- `contentType` — PROSE / TABLE / CODE / LIST,
- `tokenCount` — measured token length,
- the **embedding vector** (`vector(1536)`, added via raw SQL — pgvector isn't
  a native Prisma type),
- a generated **`tsvector`** column over `content` (GIN-indexed) for the
  keyword-search path.

So one chunk feeds *both* retrieval routes: its vector powers semantic search,
its tsvector powers keyword search, and hybrid search fuses the two.

## Re-chunking on change

When a page changes, a new `PageVersion` is written and re-indexed. The index
worker **deletes the previous version's chunks first**
(`clearChunksForVersions`), so only the latest version is ever searchable —
old versions remain in Postgres for the diff viewer but drop out of
search/RAG. This keeps the index consistent with "the current state of the
page" without ever losing history.

## Trade-offs and alternatives considered

- **Fixed-size vs. semantic chunking.** Pure fixed-size splitting is simpler
  but slices through concepts. The heading-split-then-recursive approach is a
  pragmatic middle ground: cheap, deterministic, and structure-aware, without
  the cost/complexity of an LLM-driven semantic chunker.
- **800/150 is a default, not a tuned optimum.** These are widely-used starting
  values. A production system would sweep them against a retrieval-quality
  eval; that eval harness isn't built here (noted in `docs/limitations.md`).
- **Sentence-window / parent-document retrieval** (embed small, return the
  surrounding parent) would improve answer context but adds a second storage
  tier and retrieval hop — out of scope for this project's scale.

See `docs/architecture.md` for how chunks are retrieved (keyword / semantic /
hybrid RRF) and `docs/how-it-works.md` for the end-to-end flow.
