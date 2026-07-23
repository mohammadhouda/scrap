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

| Workers | Source / rate cap | Pages | Wall time | Pages/sec |
|---|---|---|---|---|
| 1 | _(pending)_ | | | |
| 2 | _(pending)_ | | | |
| 4 | _(pending)_ | | | |

### Chaos run

| Scenario | Outcome |
|---|---|
| SIGKILL 1 of 4 workers mid-crawl | _(pending — record: pages settled vs queued, extra wall time, whether the reconciler was needed)_ |

Environment to record with results: host CPU/RAM, Docker resource limits,
`WORKER_CONCURRENCY`, network conditions, date.
