import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processDiscoverJob } from './discover-worker.js';
import type { Queues } from './queues.js';

function fakeQueues() {
  return { scrape: { add: vi.fn() } } as unknown as Queues;
}

describe('processDiscoverJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueues one scrape job per discovered URL at depth + 1', async () => {
    const queues = fakeQueues();

    const result = await processDiscoverJob(queues, {
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
  });

  it('uses a stable jobId derived from the URL so re-enqueues dedupe', async () => {
    const queues = fakeQueues();

    await processDiscoverJob(queues, {
      sourceId: 'source-1',
      urls: ['https://example.com/a'],
      parentDepth: 0,
    });
    await processDiscoverJob(queues, {
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
});
