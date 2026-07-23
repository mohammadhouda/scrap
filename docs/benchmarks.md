# Benchmarks: horizontal scaling & chaos recovery

This documents *how* the Phase 7 claims are measured, and holds the measured
results. Numbers marked _(pending)_ have not been produced yet — this file
never contains estimated or extrapolated figures, only output copied from an
actual run of the commands below.

## What is being claimed

1. **Horizontal scaling** — adding worker containers increases crawl+index
   throughput with no code or config change, because all coordination
   (queues, per-run dedup/counters, rate-limit buckets) lives in Redis.
2. **Chaos recovery** — SIGKILLing a worker mid-crawl loses no jobs: its
   in-flight jobs are re-queued to surviving workers via BullMQ's stalled-job
   detection, and the crawl run still finalizes with
   `pagesDone + pagesFailed == pagesQueued`.

## An important ceiling: the rate limiter wins on a single domain

Throughput against one domain is deliberately capped by the per-domain token
bucket (`Source.ratePerSecond`, further tightened by robots.txt
`Crawl-delay`). **Adding workers cannot and must not beat that cap** — that's
the politeness contract working as designed.

So the scaling benchmark must make the *queue* the bottleneck, not the cap.
Two sanctioned ways (toscrape.com is a sandbox built for scraping practice):

- raise the demo source's rate before the run, e.g.
  `UPDATE "Source" SET "ratePerSecond" = 25 WHERE name = 'quotes-static';`
- or crawl all three seeded sources concurrently so throughput aggregates
  across domains.

Report which one was used alongside the numbers.

## How to run

```bash
# 1. bring up the stack with N workers (repeat for N = 1, 2, 4)
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --build --scale worker=1

# 2. reset between runs so every run scrapes the same amount of work
pnpm --filter @scraper/db exec prisma db seed        # wipes pages + Redis

# 3. run the bench (enqueues one tracked crawl, waits, prints pages/sec)
pnpm --filter @scraper/worker run bench quotes-static
```

The bench script (`apps/worker/src/scripts/bench.ts`) only enqueues and
polls Postgres — it does no scraping itself, so it measures the worker
containers, not the machine it runs on. It exits non-zero if any job went
unaccounted (`settled != queued`), which doubles as the lost-job check.

### Chaos run

```bash
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale worker=4
pnpm --filter @scraper/worker run bench quotes-static &
./scripts/kill-worker.sh          # while the bench is in flight; kills 1 of 4
wait                              # bench still completes, exit code 0 = no lost jobs
```

Expected timeline: the killed worker's active jobs sit locked for up to ~30s
(BullMQ `stalledInterval`), then re-queue to survivors. Worst case — the
worker died between settling a page and decrementing the run's outstanding
counter — the scheduler's stale-run reconciler finalizes the run after
`CRAWL_STALE_AFTER_MS` (default 30 min); the bench will sit until then, which
is itself a finding worth recording.

## Results

Measured **2026-07-23**. Environment: Docker Desktop on Windows 10, 12 CPUs /
~3.9 GB RAM allocated to the Docker VM; `WORKER_CONCURRENCY=2` per container
(the scale overlay's intent — a single container stays below the rate cap so
added containers show speedup); `quotes-static` with its rate cap raised to
**25 req/s** so the queue, not the token bucket, is the bottleneck; fetches to
the live `quotes.toscrape.com` over a home connection (~0.3 s steady-state
latency); OpenAI embeddings (`text-embedding-3-small`) indexing concurrently
on the same workers. Each run was preceded by `prisma db seed` (fresh DB +
flushed Redis) so all three crawled the same 214-page set. Completion is
measured by quiescence (`settled == queued`, stable 6 s), not the run's status
flag — see Finding 2.

| Workers | Concurrency/worker | Pages | Crawl time | Pages/sec | Speedup | Lost-job check |
|---|---|---|---|---|---|---|
| 1 | 2 | 214 | 52.8 s | 4.05 | 1.00× | settled 214 == queued 214 ✓ |
| 2 | 2 | 214 | 30.6 s | 6.99 | 1.73× | settled 214 == queued 214 ✓ |
| 4 | 2 | 214 | 19.4 s | 11.03 | 2.72× | settled 214 == queued 214 ✓ |

Throughput scales monotonically with worker count but **sublinearly** (2.72×
at 4×). None of the runs was rate-cap-bound (11 pages/s « 25 req/s cap), so the
gap is real overhead, dominated by:

- **A hot `CrawlRun` row.** Every reserve does `UPDATE "CrawlRun" SET
  "pagesQueued" = pagesQueued + 1` and every settle does the same for
  `pagesDone`, all on the *one* row for the run. With more workers these
  serialize on that row's lock — a self-inflicted scaling ceiling independent
  of the target site. Batched or per-worker-sharded counters would relax it.
- Shared per-domain token-bucket coordination (one Redis key, one Lua eval per
  fetch) and concurrent indexing sharing each worker's event loop.

### Chaos run

| Scenario | Outcome |
|---|---|
| SIGKILL 1 of 4 workers mid-crawl (killed at 20/83 pages) | **Lost job.** The run got stuck `RUNNING` at **213/214** indefinitely. All queues drained empty (scrape/discover/index: 0 wait/active/delayed/failed); Redis showed `seen`=214, `settled`=213, `outstanding`=1. One URL was reserved but its scrape job was never enqueued, so nothing reprocessed it. BullMQ stalled-job detection did **not** recover it (there was no job to reclaim). Only the scheduler's 30-min stale reconciler would eventually force-finalize the *run* — but that page stays uncrawled. See Finding 3. |

This is a **negative result**: the "zero lost jobs under worker kill" claim in
the plan does **not** hold as implemented. The chaos harness did its job —
it found a real fault-tolerance bug (Finding 3).

## Findings (what running Phase 7 surfaced)

### Finding 1 — indexing was completely broken (FIXED)

Every `index` job failed with `APIConnectionError` →
`InvalidArgumentError: invalid content-length header`. Root cause: importing
`@scraper/processor` pulls in jsdom (via `@mozilla/readability`), which calls
undici's `setGlobalDispatcher` at import time, installing a *userland*
`undici@7.28.0` Agent (hoisted from cheerio) as the process-wide dispatcher.
From then on every `globalThis.fetch` — including the OpenAI SDK's — is
dispatched through that stricter undici, which rejects the manual
`content-length` header the SDK sets on POST bodies (Node's built-in undici
tolerates it). Because every worker loads the processor, **no embeddings were
ever produced** on the freshly built image.

Diagnosis was by bisection inside the container: the global dispatcher symbol
(`Symbol.for('undici.globalDispatcher.1')`) is `undefined` at startup and
becomes an `Agent` immediately after `import('@scraper/processor')`.

**Fix (`packages/rag/src/openai-fetch.ts`):** wrap the OpenAI client's `fetch`
to strip `content-length` and let the active dispatcher recompute it — safe
and dispatcher-agnostic. Applied to both `embed.ts` and `ask.ts`. Verified
in-container: the embedder returns 1536-dim vectors even after the processor
import installs the Agent.

### Finding 2 — premature crawl-run finalization (race; eventually consistent)

On a clean run the run's status flips to `SUCCEEDED` *before* the crawl
actually finishes. Observed every run (e.g. worker=1 reported `SUCCEEDED` at
46.7 s with 184/214 pages, then kept crawling to 214/214 by ~53 s).

Cause: a scrape job enqueues its `discover` job and then settles (decrementing
`outstanding`), but the discovered children aren't reserved (incrementing
`outstanding`) until that async discover job runs later. If `outstanding`
transiently reaches 0 in that gap near the end of a crawl,
`settleScrapeForRun` finalizes the run early. Counters are *eventually*
consistent (no data lost on a clean run), but the "finalizes with
`settled == queued`" invariant does not hold at the instant of finalization —
so consumers watching `status` (a UI, or a naive bench) see "done" while work
continues. `bench.ts` measures quiescence instead to work around this.

### Finding 3 — a job is lost when a worker is SIGKILLed (NOT yet fixed)

`processDiscoverJob` does two non-atomic steps per URL: `reserveUrlForRun`
(Redis `SADD seen` + `INCR outstanding` + Postgres `pagesQueued++`) and then
`queues.scrape.add(...)`. A SIGKILL between them leaves the URL *reserved* but
with no scrape job — and when the discover job is retried, `reserveUrlForRun`
returns false (already in `seen`), so the scrape job is never created. The URL
is orphaned: `outstanding` never returns to 0, the run never finalizes
normally, and the page is never crawled. Reproduced above (stuck 213/214,
`outstanding`=1, all queues empty).

Findings 2 and 3 share a root cause: the crawl-run bookkeeping (`seen` /
`outstanding` / `pagesQueued`) is spread across multiple non-atomic
Redis + Postgres + queue operations, so a crash or a scheduling gap between
them breaks the invariant. A correct fix makes reserve-and-enqueue atomic (or
idempotently recoverable) and counts an in-flight discover job as outstanding
work — a deliberate change to the coordination core, tracked as follow-up.
