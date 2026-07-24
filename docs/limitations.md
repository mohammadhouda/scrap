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
