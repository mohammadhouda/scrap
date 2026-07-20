import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reserveUrlForRun } = vi.hoisted(() => ({ reserveUrlForRun: vi.fn() }));
vi.mock('@scraper/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@scraper/scraper')>();
  return { ...actual, reserveUrlForRun };
});

const { processDiscoverJob } = await import('./discover-worker.js');
import type { Queues } from './queues.js';
import type { Redis } from 'ioredis';

function fakeQueues() {
  return { scrape: { add: vi.fn() } } as unknown as Queues;
}

const redis = {} as Redis;

describe('processDiscoverJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueues one scrape job per discovered URL at depth + 1 (untracked)', async () => {
    const queues = fakeQueues();

    const result = await processDiscoverJob(queues, redis, {
      sourceId: 'source-1',
      urls: ['https://example.com/a', 'https://example.com/b'],
      parentDepth: 2,
    });

    expect(result).toEqual({ enqueued: 2 });
    expect(queues.scrape.add).toHaveBeenCalledTimes(2);
    expect(queues.scrape.add).toHaveBeenCalledWith(
      'scrape',
      { sourceId: 'source-1', url: 'https://example.com/a', depth: 3 },
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(reserveUrlForRun).not.toHaveBeenCalled();
  });

  it('uses a stable jobId derived from the URL so re-enqueues dedupe (untracked)', async () => {
    const queues = fakeQueues();

    await processDiscoverJob(queues, redis, {
      sourceId: 'source-1',
      urls: ['https://example.com/a'],
      parentDepth: 0,
    });
    await processDiscoverJob(queues, redis, {
      sourceId: 'source-1',
      urls: ['https://example.com/a'],
      parentDepth: 0,
    });

    const calls = (queues.scrape.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const jobIdA = calls[0]?.[2].jobId;
    const jobIdB = calls[1]?.[2].jobId;
    expect(jobIdA).toBe(jobIdB);
  });

  it('reserves each URL for a tracked run and only enqueues newly-reserved ones', async () => {
    const queues = fakeQueues();
    // First URL is new for the run, second is a duplicate already reserved.
    reserveUrlForRun.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await processDiscoverJob(queues, redis, {
      sourceId: 'source-1',
      urls: ['https://example.com/a', 'https://example.com/b'],
      parentDepth: 0,
      crawlRunId: 'run-1',
    });

    expect(reserveUrlForRun).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ enqueued: 1 });
    expect(queues.scrape.add).toHaveBeenCalledTimes(1);
    expect(queues.scrape.add).toHaveBeenCalledWith(
      'scrape',
      { sourceId: 'source-1', url: 'https://example.com/a', depth: 1, crawlRunId: 'run-1' },
      expect.objectContaining({ jobId: expect.stringMatching(/^run-1:/) }),
    );
  });
});
