import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

const { crawlRunUpdate, crawlRunUpdateMany, crawlRunFindUnique, crawlRunCreate, queryRaw } =
  vi.hoisted(() => ({
    crawlRunUpdate: vi.fn(),
    crawlRunUpdateMany: vi.fn(),
    crawlRunFindUnique: vi.fn(),
    crawlRunCreate: vi.fn(),
    queryRaw: vi.fn(),
  }));

vi.mock('@scraper/db', () => ({
  prisma: {
    crawlRun: {
      update: crawlRunUpdate,
      updateMany: crawlRunUpdateMany,
      findUnique: crawlRunFindUnique,
      create: crawlRunCreate,
    },
    $queryRaw: queryRaw,
  },
  CrawlStatus: { RUNNING: 'RUNNING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' },
}));

const {
  reserveUrlForRun,
  confirmUrlEnqueued,
  settleScrapeForRun,
  cancelCrawlRun,
  reconcileStaleRuns,
  scrapeJobId,
} = await import('./crawl-run.js');

// Minimal in-memory Redis fake: SADD (set semantics), INCR/DECR counters,
// string keys (set/exists/del), and no-op EXPIRE — enough to exercise the
// reserve/settle/cancel bookkeeping.
function fakeRedis() {
  const sets = new Map<string, Set<string>>();
  const counters = new Map<string, number>();
  const strings = new Map<string, string>();

  const redis = {
    sadd: vi.fn(async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      const had = set.has(member);
      set.add(member);
      sets.set(key, set);
      return had ? 0 : 1;
    }),
    sismember: vi.fn(async (key: string, member: string) => (sets.get(key)?.has(member) ? 1 : 0)),
    scard: vi.fn(async (key: string) => sets.get(key)?.size ?? 0),
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) - 1;
      counters.set(key, next);
      return next;
    }),
    set: vi.fn(async (key: string, value: string) => {
      strings.set(key, value);
      return 'OK';
    }),
    exists: vi.fn(async (key: string) => (strings.has(key) ? 1 : 0)),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) {
        counters.delete(key);
        strings.delete(key);
        sets.delete(key);
      }
      return keys.length;
    }),
    multi: vi.fn(() => {
      const chain = {
        incr: (key: string) => {
          counters.set(key, (counters.get(key) ?? 0) + 1);
          return chain;
        },
        sadd: (key: string, member: string) => {
          const set = sets.get(key) ?? new Set<string>();
          set.add(member);
          sets.set(key, set);
          return chain;
        },
        expire: () => chain,
        exec: async () => [],
      };
      return chain;
    }),
  };
  return redis as unknown as Redis;
}

describe('crawl-run bookkeeping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('produces a jobId with no ":" (BullMQ forbids it in custom ids)', () => {
    const id = scrapeJobId('run-1', 'https://x.com/a');
    expect(id).not.toContain(':');
    expect(id.startsWith('run-1-')).toBe(true);
  });

  it('reserves a URL once per run and only counts the first sighting', async () => {
    const redis = fakeRedis();

    const first = await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');
    await confirmUrlEnqueued(redis, 'run-1', 'https://x.com/a');
    // Second sighting, now that its scrape job is confirmed, is a true duplicate.
    const second = await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');

    expect(first).toBe(true);
    expect(second).toBe(false);
    // pagesQueued incremented only on the first reservation.
    expect(crawlRunUpdate).toHaveBeenCalledTimes(1);
    expect(crawlRunUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { pagesQueued: { increment: 1 } },
    });
  });

  it('recovers a lost job: re-drives enqueue for a reserved-but-unconfirmed URL', async () => {
    const redis = fakeRedis();

    // First attempt reserves (counts) the URL, then the worker is SIGKILLed
    // before it can enqueue the scrape job -> confirmUrlEnqueued never runs.
    const first = await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');

    // The discover job is retried by BullMQ. The URL is already in `seen`, but
    // its scrape job was never confirmed, so reserve must return true again so
    // the retry re-creates the (idempotent, deterministic-jobId) scrape job.
    const retry = await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');

    expect(first).toBe(true);
    expect(retry).toBe(true);
    // But it must NOT be double-counted: pagesQueued + outstanding move once.
    expect(crawlRunUpdate).toHaveBeenCalledTimes(1);

    // After the retry confirms the enqueue, a further sighting is a no-op.
    await confirmUrlEnqueued(redis, 'run-1', 'https://x.com/a');
    const afterConfirm = await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');
    expect(afterConfirm).toBe(false);
    expect(crawlRunUpdate).toHaveBeenCalledTimes(1);
  });

  it('finalizes the run as SUCCEEDED once outstanding reaches zero', async () => {
    const redis = fakeRedis();
    crawlRunFindUnique.mockResolvedValue({ id: 'run-1', pagesDone: 2, pagesFailed: 0 });

    // Two reserved URLs → outstanding = 2.
    await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');
    await reserveUrlForRun(redis, 'run-1', 'https://x.com/b');

    await settleScrapeForRun(redis, 'run-1', 'https://x.com/a', 'done');
    expect(crawlRunUpdateMany).not.toHaveBeenCalled(); // still one outstanding

    await settleScrapeForRun(redis, 'run-1', 'https://x.com/b', 'done');
    expect(crawlRunUpdateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'RUNNING' },
      // pagesQueued reconciled from the `seen` set (2 URLs reserved above).
      data: { status: 'SUCCEEDED', finishedAt: expect.any(Date), pagesQueued: 2 },
    });
  });

  it('is idempotent: settling the same URL twice does not double-count', async () => {
    const redis = fakeRedis();
    crawlRunFindUnique.mockResolvedValue({ id: 'run-1', pagesDone: 1, pagesFailed: 0 });

    await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');

    await settleScrapeForRun(redis, 'run-1', 'https://x.com/a', 'done');
    await settleScrapeForRun(redis, 'run-1', 'https://x.com/a', 'done');

    // pagesDone incremented only once despite two settle calls.
    const doneUpdates = crawlRunUpdate.mock.calls.filter(
      ([arg]) => arg.data?.pagesDone,
    );
    expect(doneUpdates).toHaveLength(1);
    // Finalized exactly once.
    expect(crawlRunUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('reconciles pagesQueued from `seen` at finalize, correcting crash-gap drift', async () => {
    const redis = fakeRedis();
    crawlRunFindUnique.mockResolvedValue({ id: 'run-1', pagesDone: 1, pagesFailed: 0 });

    // Reserve one URL normally: outstanding = 1, seen = {a}, pagesQueued++ once.
    await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');

    // Model the crash-gap: another URL made it into `seen` (its Redis
    // reservation committed) but its Postgres pagesQueued++ was lost. Its
    // outstanding was already counted, so it does not add a second unit here.
    await redis.sadd('crawl:run-1:seen', 'hash-of-b');

    // The single outstanding unit settles -> run finalizes. pagesQueued must be
    // reconciled to |seen| = 2, not the drifted Postgres increment count of 1.
    await settleScrapeForRun(redis, 'run-1', 'https://x.com/a', 'done');

    const finalize = crawlRunUpdateMany.mock.calls.at(-1)?.[0];
    expect(finalize?.data.pagesQueued).toBe(2);
    expect(finalize?.data.status).toBe('SUCCEEDED');
  });

  it('finalizes as FAILED when no page succeeded', async () => {
    const redis = fakeRedis();
    crawlRunFindUnique.mockResolvedValue({ id: 'run-1', pagesDone: 0, pagesFailed: 1 });

    await reserveUrlForRun(redis, 'run-1', 'https://x.com/a');
    await settleScrapeForRun(redis, 'run-1', 'https://x.com/a', 'failed');

    expect(crawlRunUpdateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'RUNNING' },
      data: { status: 'FAILED', finishedAt: expect.any(Date), pagesQueued: 1 },
    });
  });

  it('cancels a running run and stops further fan-out', async () => {
    const redis = fakeRedis();
    crawlRunUpdateMany.mockResolvedValue({ count: 1 });

    const cancelled = await cancelCrawlRun(redis, 'run-1');
    expect(cancelled).toBe(true);
    expect(crawlRunUpdateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: 'RUNNING' },
      data: { status: 'CANCELLED', finishedAt: expect.any(Date) },
    });

    // After cancellation, reserving a new URL is a no-op (no scrape job fans out).
    const reserved = await reserveUrlForRun(redis, 'run-1', 'https://x.com/new');
    expect(reserved).toBe(false);
  });

  it('reports cancelled=false when the run already finished', async () => {
    const redis = fakeRedis();
    crawlRunUpdateMany.mockResolvedValue({ count: 0 });

    const cancelled = await cancelCrawlRun(redis, 'run-1');
    expect(cancelled).toBe(false);
  });

  it('reconciles stale runs and cleans up their Redis keys', async () => {
    const redis = fakeRedis();
    queryRaw.mockResolvedValue([{ id: 'stuck-1' }, { id: 'stuck-2' }]);

    const count = await reconcileStaleRuns(redis, { staleAfterMs: 60_000 });

    expect(count).toBe(2);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    // Each reconciled run's per-run keys are cleared (5 keys × 2 runs).
    expect(redis.del).toHaveBeenCalledTimes(2);
  });

  it('reconciles nothing (and skips Redis work) when no runs are stale', async () => {
    const redis = fakeRedis();
    queryRaw.mockResolvedValue([]);

    const count = await reconcileStaleRuns(redis, { staleAfterMs: 60_000 });

    expect(count).toBe(0);
    expect(redis.del).not.toHaveBeenCalled();
  });
});
