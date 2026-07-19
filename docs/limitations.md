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

## 3. No relevance threshold on retrieval

`keywordSearch`/`semanticSearch`/`hybridSearch` always return up to
`topK` results regardless of how weak the match is — there's no minimum
similarity/rank cutoff. Asked something with zero relevant crawled
content ("What's the return policy for orders over $100?"), the retriever
still returned 8 unrelated book chunks as context. The model handled this
correctly in testing (declined to answer), but the design relies entirely
on the LLM's judgment to ignore irrelevant context rather than the
retrieval layer filtering it out before the prompt is built.

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

## 7. Horizontal scaling and chaos recovery are unvalidated as of this writing

Phase 7 (`docker-compose.scale.yml`, `scripts/bench.ts`,
`scripts/kill-worker.sh`) has not been built yet, so the "near-linear
speedup" and "zero lost jobs under worker kill" claims in the plan are
architectural intent, not yet measured results. See `docs/benchmarks.md`
once populated.
