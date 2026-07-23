# Known limitations

Documented from live testing against the real deployed system (real OpenAI
embeddings + GPT-5.5, real crawled data across all three sources), not
speculation. Each one below was reproduced and is cheap to re-verify by
asking the same question again.

## 1. Retrieval starves one side of a compound question

`hybridSearch` (`packages/rag/hybrid.ts`) returns one Reciprocal-Rank-Fused
list capped at `topK` (default 8) for the *entire* question. There is no
query decomposition and no per-source diversity guarantee — the top 8 are
simply whichever chunks score highest across the whole question's
embedding + keyword match.

For a single-topic question this is fine. For a compound one, whichever
half has the stronger match signal crowds out the other entirely:

- **Q:** "What does Albert Einstein say about imagination, and what genre
  is 'The Mirror & the Maze' shelved under?"
- **Result:** all 8 retrieved chunks were quote pages; zero were from
  `books.toscrape.com`. The book is real, crawled data (confirmed directly
  in Postgres), but no chunk about it made it into the retrieval set, so
  the model correctly said it had no information about the book rather
  than guessing.

**Fix, if pursued:** split multi-intent questions into sub-queries and
retrieve top-K per sub-query before merging, or reserve retrieval slots
per source when no explicit `source` filter is given.

## 2. Citations prove a source was retrieved, not that it's characterized correctly

The prompt (`packages/rag/prompt.ts`) forces every claim to cite `[n]`,
and the API guarantees `[n]` always maps to a chunk that was actually in
the retrieval set (`packages/rag/ask.ts`'s `toCitations`) — so a citation
can never point at a URL the model invented. That's a narrower guarantee
than "the answer is correct," though:

- **Q:** "Who is quoted talking about books or reading, and what's a real
  nonfiction title from the catalogue?"
- **Result:** the model answered *"one real book title listed in the
  catalogue is Ralph Waldo Emerson's Nature[4]"* — citation `[4]` is a
  real, retrieved URL, but it's `quotes.toscrape.com/author/Ralph-Waldo-Emerson`
  (a quote-author bio page), not anything from the books catalogue. The
  citation is genuine; the model's description of what that source
  *is* is wrong. Same root cause as #1 — no books chunk was retrieved, and
  rather than saying so, the model reached for the closest available
  citation and mislabeled it.

This means citation-checking a Q&A system's output for "does `[n]` point
to a real retrieved chunk" is necessary but not sufficient for trusting
the answer.

## 3. ~~No relevance threshold on retrieval~~ (addressed)

**Addressed:** `semanticSearch` now applies a cosine-similarity floor
(`DEFAULT_MIN_SIMILARITY` in `packages/rag/src/retrieve.ts`, overridable
per call via `minSimilarity`), so a question with zero relevant indexed
content yields zero semantic chunks and `/ask` answers "nothing found"
from the retrieval layer instead of relying on the LLM to decline.
Keyword search needs no floor — `websearch_to_tsquery` already requires a
lexical match. Remaining caveat: the 0.25 default is a conservative
constant, not tuned against a labeled relevance set; re-test the
limitation-#1 compound questions after any retuning.

## 4. Cleaning pipeline falls back to raw HTML on some listing pages

`packages/processor/clean.ts` falls back to raw body extraction when
Readability can't identify an article on non-article (listing/catalog)
pages. On some `books.toscrape.com` category pages this leaves literal
HTML comments and tags (`<!-- <a id="write_review" ... -->`) inside
`cleanedMd`, which then get chunked and indexed as-is — visible directly
in `/search` results for keyword/hybrid queries against those pages.
Content is not lost or corrupted, but not fully cleaned either.

## 5. `/ask` is single-turn

Each question is answered independently — there's no conversation history
passed to the model, so follow-up questions like "what else did they say"
have no prior context to resolve against.

## 6. GPT-5.5 response latency is highly variable

Observed time-to-first-token ranged from under a second to 70+ seconds
across otherwise-identical requests during testing. The UI shows an
indeterminate "Thinking..." state throughout, with no client-side timeout
— a sufficiently slow response just keeps the user waiting rather than
surfacing a timeout error.

## 7. Horizontal scaling measured; chaos recovery FAILED (lost job under kill)

Phase 7 was run (2026-07-23, see `docs/benchmarks.md` for full numbers):

- **Scaling holds, sublinearly.** `quotes-static` (214 pages, rate cap
  raised to 25 req/s) crawled in 52.8 s / 30.6 s / 19.4 s at 1 / 2 / 4
  workers — 4.05 → 6.99 → 11.03 pages/s (1.00× / 1.73× / 2.72×). The gap
  from linear is dominated by a hot `CrawlRun` counter row every reserve and
  settle updates, which serializes across workers.
- **Chaos recovery does NOT hold as implemented.** SIGKILLing 1 of 4 workers
  mid-crawl left the run stuck at 213/214 with one URL orphaned (reserved but
  never enqueued as a scrape job). `reserveUrlForRun` + `queues.scrape.add`
  in `processDiscoverJob` are not atomic, so a crash between them loses the
  job; BullMQ's stalled-job detection can't recover it because no job exists
  to reclaim. The "zero lost jobs under worker kill" claim is currently false.

Two coordination bugs were found and one more was fixed along the way:
- **(fixed)** indexing was fully broken — jsdom's `setGlobalDispatcher`
  routed the OpenAI SDK through a strict undici that rejected its
  `content-length`; see `docs/benchmarks.md` Finding 1 and
  `packages/rag/src/openai-fetch.ts`.
- **(open)** premature run finalization (Finding 2) and the lost-job race
  (Finding 3) both stem from non-atomic crawl-run bookkeeping and need a
  coordination-core fix.
