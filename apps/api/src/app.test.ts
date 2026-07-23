import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const {
  sourceFindMany,
  sourceFindUnique,
  sourceCreate,
  pageFindMany,
  pageFindUnique,
  pageCount,
  queryRaw,
} = vi.hoisted(() => ({
  sourceFindMany: vi.fn(),
  sourceFindUnique: vi.fn(),
  sourceCreate: vi.fn(),
  pageFindMany: vi.fn(),
  pageFindUnique: vi.fn(),
  pageCount: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@scraper/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@scraper/db')>();
  return {
    ...actual,
    prisma: {
      source: { findMany: sourceFindMany, findUnique: sourceFindUnique, create: sourceCreate },
      page: { findMany: pageFindMany, findUnique: pageFindUnique, count: pageCount },
      $queryRaw: queryRaw,
    },
  };
});

const { buildApp } = await import('./app.js');

const testSource = {
  id: 'source-1',
  name: 'quotes-static',
  seedUrl: 'http://quotes.toscrape.com/',
  allowPatterns: [],
  denyPatterns: [],
  renderJs: false,
  maxDepth: 15,
  ratePerSecond: 2,
  scheduleCron: null,
  createdAt: new Date(),
};

function fakeQueues() {
  const makeQueue = () => ({
    add: vi.fn(),
    getJobCounts: vi.fn().mockResolvedValue({ wait: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
    getFailed: vi.fn().mockResolvedValue([]),
    getJob: vi.fn().mockResolvedValue(undefined),
  });
  return { scrape: makeQueue(), discover: makeQueue(), index: makeQueue() } as unknown as import('./queues.js').Queues;
}

async function buildTestApp(): Promise<{
  app: FastifyInstance;
  queues: ReturnType<typeof fakeQueues>;
  ask: ReturnType<typeof vi.fn>;
}> {
  const queues = fakeQueues();
  const embedTexts = vi.fn().mockResolvedValue([[0.1, 0.2]]);
  const ask = vi.fn();
  const app = await buildApp({ queues, embedTexts, ask });
  return { app, queues, ask };
}

const ADMIN_TOKEN = 'test-admin-token';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

describe('GET /sources', () => {
  it('lists sources', async () => {
    sourceFindMany.mockResolvedValue([testSource]);
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/sources' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });
});

describe('POST /sources', () => {
  it('rejects without an admin token', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      payload: { name: 'x', seedUrl: 'https://example.com' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('creates a source with a valid admin token', async () => {
    sourceCreate.mockResolvedValue(testSource);
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: 'quotes-static', seedUrl: 'http://quotes.toscrape.com/' },
    });

    expect(response.statusCode).toBe(201);
    expect(sourceCreate).toHaveBeenCalled();
  });

  it('rejects an invalid body even with a valid token', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { name: '', seedUrl: 'not-a-url' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /sources/:id/crawl', () => {
  it('rejects without an admin token', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/sources/source-1/crawl' });
    expect(response.statusCode).toBe(401);
  });

  it('404s for an unknown source', async () => {
    sourceFindUnique.mockResolvedValue(null);
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/sources/missing/crawl',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('enqueues a scrape job for a known source', async () => {
    sourceFindUnique.mockResolvedValue(testSource);
    const { app, queues } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/sources/source-1/crawl',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    expect(response.statusCode).toBe(202);
    expect(queues.scrape.add).toHaveBeenCalledWith('scrape', {
      sourceId: 'source-1',
      url: testSource.seedUrl,
      depth: 0,
    });
  });

  it('accepts an empty body sent with an application/json content-type', async () => {
    // Reproduces the browser fetch(): Content-Type: application/json with no
    // body. Without the lenient parser this 400s (FST_ERR_CTP_EMPTY_JSON_BODY).
    sourceFindUnique.mockResolvedValue(testSource);
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/sources/source-1/crawl',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(202);
  });
});

describe('GET /pages', () => {
  it('returns a paginated list', async () => {
    pageFindMany.mockResolvedValue([{ id: 'p1' }]);
    pageCount.mockResolvedValue(1);
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/pages' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: 'p1' }], total: 1, page: 1, pageSize: 20 });
  });
});

describe('GET /pages/:id', () => {
  it('404s for an unknown page', async () => {
    pageFindUnique.mockResolvedValue(null);
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/pages/missing' });
    expect(response.statusCode).toBe(404);
  });

  it('returns the page with its source name', async () => {
    pageFindUnique.mockResolvedValue({ id: 'p1', url: 'https://x.com', source: { name: 'quotes' } });
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/pages/p1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'p1', url: 'https://x.com', source: { name: 'quotes' } });
  });
});

describe('GET /pages/:id/versions', () => {
  it('404s for an unknown page', async () => {
    pageFindUnique.mockResolvedValue(null);
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/pages/missing/versions' });
    expect(response.statusCode).toBe(404);
  });

  it('returns version history with chunks for a known page', async () => {
    pageFindUnique.mockResolvedValue({
      id: 'p1',
      versions: [
        { version: 2, chunks: [{ id: 'c1', index: 0, heading: null, content: 'hi', contentType: 'PROSE' }] },
        { version: 1, chunks: [] },
      ],
    });
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/pages/p1/versions' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
    expect(response.json()[0].chunks).toHaveLength(1);
  });
});

describe('GET /search', () => {
  it('runs a keyword search and returns results', async () => {
    queryRaw.mockResolvedValue([{ chunkId: 'c1', content: 'hit', heading: null, url: 'https://x.com', title: null, sourceId: 's1' }]);
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/search?q=scraping&mode=keyword' });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toHaveLength(1);
  });

  it('404s for an unknown source filter', async () => {
    sourceFindUnique.mockResolvedValue(null);
    const { app } = await buildTestApp();

    const response = await app.inject({ method: 'GET', url: '/search?q=x&source=nope' });
    expect(response.statusCode).toBe(404);
  });

  it('requires a non-empty query', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/search?q=' });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /ask', () => {
  async function* fakeStream() {
    yield 'The answer';
    yield ' is 42 [1].';
  }

  it('streams citations, tokens, and a done event over SSE', async () => {
    const { app, ask } = await buildTestApp();
    ask.mockResolvedValue({
      answerStream: fakeStream(),
      citations: [{ n: 1, url: 'https://x.com', title: 'X', chunkId: 'c1', pageId: 'p1' }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/ask',
      headers: { origin: 'http://localhost:3000' },
      payload: { question: 'What is the answer?' },
    });

    expect(response.headers['content-type']).toContain('text/event-stream');
    // hijack() bypasses @fastify/cors's onSend hook, so this header is set
    // by hand in the route -- regression test for that.
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.payload).toContain('event: citations');
    expect(response.payload).toContain('"url":"https://x.com"');
    expect(response.payload).toContain('event: token');
    expect(response.payload).toContain('The answer');
    // After streaming, the route narrows the retrieval set to the [n] markers
    // the model actually used ("... is 42 [1]." -> [1]).
    expect(response.payload).toContain('event: citations-used');
    expect(response.payload).toContain('"indices":[1]');
    expect(response.payload).toContain('event: done');
  });

  it('404s for an unknown source filter', async () => {
    sourceFindUnique.mockResolvedValue(null);
    const { app } = await buildTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/ask',
      payload: { question: 'Q', source: 'nope' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('admin routes', () => {
  it('GET /admin/queues rejects without a token', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/admin/queues' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /admin/queues returns counts per queue with a valid token', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/admin/queues',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(3);
  });

  it('GET /admin/dlq returns failed jobs', async () => {
    const { app, queues } = await buildTestApp();
    (queues.scrape.getFailed as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '1', name: 'scrape', data: {}, failedReason: 'boom', attemptsMade: 5, timestamp: 123 },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/admin/dlq',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it('POST /admin/dlq/:id/retry 404s for an unknown job', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/dlq/missing/retry',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('POST /admin/dlq/:id/retry retries a known job', async () => {
    const { app, queues } = await buildTestApp();
    const retry = vi.fn();
    (queues.scrape.getJob as ReturnType<typeof vi.fn>).mockResolvedValue({ retry });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/dlq/job-1/retry',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(retry).toHaveBeenCalled();
  });
});
