import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = {
  id: 'source-1',
  seedUrl: 'https://example.com',
  allowPatterns: [] as string[],
  denyPatterns: [] as string[],
  renderJs: false,
  maxDepth: 3,
  ratePerSecond: 5,
};

const { findUniqueOrThrow } = vi.hoisted(() => ({ findUniqueOrThrow: vi.fn() }));
vi.mock('@scraper/db', () => ({
  prisma: { source: { findUniqueOrThrow } },
}));

const {
  checkRobots,
  acquireRateLimitSlot,
  cheerioFetch,
  playwrightFetch,
  getLatestVersion,
  persistVersion,
  touchLastSeen,
} = vi.hoisted(() => ({
  checkRobots: vi.fn(),
  acquireRateLimitSlot: vi.fn(),
  cheerioFetch: vi.fn(),
  playwrightFetch: vi.fn(),
  getLatestVersion: vi.fn(),
  persistVersion: vi.fn(),
  touchLastSeen: vi.fn(),
}));

vi.mock('@scraper/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@scraper/scraper')>();
  return {
    ...actual,
    checkRobots,
    acquireRateLimitSlot,
    cheerioFetch,
    playwrightFetch,
    getLatestVersion,
    persistVersion,
    touchLastSeen,
  };
});

const { processScrapeJob } = await import('./worker.js');

function fakeQueues() {
  return {
    scrape: { add: vi.fn() },
    discover: { add: vi.fn() },
    index: { add: vi.fn() },
  } as unknown as import('./queues.js').Queues;
}

const connection = {} as import('ioredis').Redis;

describe('processScrapeJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueOrThrow.mockResolvedValue(source);
    checkRobots.mockResolvedValue({ allowed: true });
    acquireRateLimitSlot.mockResolvedValue(undefined);
    cheerioFetch.mockResolvedValue({
      html: '<html>hello</html>',
      discoveredLinks: ['https://example.com/next'],
      title: 'Hello',
    });
    getLatestVersion.mockResolvedValue(undefined);
    persistVersion.mockResolvedValue({ id: 'pv-1', version: 1 });
  });

  it('skips fetching when robots.txt disallows the URL', async () => {
    checkRobots.mockResolvedValue({ allowed: false });
    const queues = fakeQueues();

    const result = await processScrapeJob(connection, queues, {
      sourceId: source.id,
      url: 'https://example.com/blocked',
      depth: 0,
    });

    expect(result).toEqual({ skipped: 'robots' });
    expect(cheerioFetch).not.toHaveBeenCalled();
  });

  it('touches lastSeenAt and skips persistence when content is unchanged', async () => {
    getLatestVersion.mockResolvedValue({ contentHash: expect.any(String) });
    // Match the hash the worker will compute for the fetched HTML.
    const { sha256 } = await import('@scraper/scraper');
    getLatestVersion.mockResolvedValue({ contentHash: sha256('<html>hello</html>') });

    const queues = fakeQueues();
    const result = await processScrapeJob(connection, queues, {
      sourceId: source.id,
      url: 'https://example.com/page',
      depth: 0,
    });

    expect(result).toEqual({ unchanged: true });
    expect(touchLastSeen).toHaveBeenCalledWith('https://example.com/page');
    expect(persistVersion).not.toHaveBeenCalled();
  });

  it('persists a new version and fans out discover + index jobs when content changed', async () => {
    const queues = fakeQueues();

    const result = await processScrapeJob(connection, queues, {
      sourceId: source.id,
      url: 'https://example.com/page',
      depth: 0,
    });

    expect(result).toEqual({ versioned: 1 });
    expect(persistVersion).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: source.id, url: 'https://example.com/page' }),
    );
    expect(queues.discover.add).toHaveBeenCalledWith(
      'links',
      expect.objectContaining({ urls: ['https://example.com/next'], parentDepth: 0 }),
    );
    expect(queues.index.add).toHaveBeenCalledWith('index', { pageVersionId: 'pv-1' });
  });

  it('does not enqueue further discovery once maxDepth is reached', async () => {
    findUniqueOrThrow.mockResolvedValue({ ...source, maxDepth: 1 });
    const queues = fakeQueues();

    await processScrapeJob(connection, queues, {
      sourceId: source.id,
      url: 'https://example.com/page',
      depth: 1,
    });

    expect(queues.discover.add).not.toHaveBeenCalled();
  });

  it('uses the playwright fetcher when the source renders JS', async () => {
    findUniqueOrThrow.mockResolvedValue({ ...source, renderJs: true });
    playwrightFetch.mockResolvedValue({ html: '<html>js</html>', discoveredLinks: [], title: 'JS' });
    const queues = fakeQueues();

    await processScrapeJob(connection, queues, {
      sourceId: source.id,
      url: 'https://example.com/spa',
      depth: 0,
    });

    expect(playwrightFetch).toHaveBeenCalledWith('https://example.com/spa');
    expect(cheerioFetch).not.toHaveBeenCalled();
  });
});
