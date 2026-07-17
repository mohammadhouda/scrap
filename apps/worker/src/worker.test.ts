import { describe, expect, it, vi } from 'vitest';

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((queueName: string, processor: unknown) => ({
    queueName,
    processor,
  })),
}));

describe('buildScrapeWorker', () => {
  it('registers a worker on the scrape queue', async () => {
    const { buildScrapeWorker } = await import('./worker.js');
    const worker = buildScrapeWorker({}) as unknown as { queueName: string };

    expect(worker.queueName).toBe('scrape');
  });
});
