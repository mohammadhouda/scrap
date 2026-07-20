import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { prisma } from '@scraper/db';
import {
  cancelCrawlRun,
  reserveUrlForRun,
  scrapeJobId,
  startCrawlRun,
} from '@scraper/scraper/crawl-run';
import { sourceSchema } from '@scraper/shared';
import { requireAdmin } from '../auth.js';
import type { Queues } from '../queues.js';

const sourceResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  seedUrl: z.string(),
  allowPatterns: z.array(z.string()),
  denyPatterns: z.array(z.string()),
  renderJs: z.boolean(),
  maxDepth: z.number(),
  ratePerSecond: z.number(),
  scheduleCron: z.string().nullable(),
  createdAt: z.date(),
});

const crawlRunResponseSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']),
  startedAt: z.date(),
  finishedAt: z.date().nullable(),
  pagesQueued: z.number(),
  pagesDone: z.number(),
  pagesFailed: z.number(),
});

export function sourcesRoutes(queues: Queues, redis?: Redis): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/sources',
      { schema: { response: { 200: z.array(sourceResponseSchema) } } },
      async () => prisma.source.findMany({ orderBy: { createdAt: 'desc' } }),
    );

    app.get(
      '/sources/:id/crawls',
      {
        schema: {
          params: z.object({ id: z.string() }),
          querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }),
          response: {
            200: z.array(crawlRunResponseSchema),
            404: z.object({ error: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const source = await prisma.source.findUnique({ where: { id: request.params.id } });
        if (!source) {
          return reply.code(404).send({ error: 'source not found' });
        }

        return prisma.crawlRun.findMany({
          where: { sourceId: source.id },
          orderBy: { startedAt: 'desc' },
          take: request.query.limit,
        });
      },
    );

    app.post(
      '/crawls/:id/cancel',
      {
        preHandler: requireAdmin,
        schema: {
          params: z.object({ id: z.string() }),
          response: {
            200: z.object({ cancelled: z.boolean() }),
            404: z.object({ error: z.string() }),
            503: z.object({ error: z.string() }),
          },
        },
      },
      async (request, reply) => {
        if (!redis) {
          return reply.code(503).send({ error: 'cancellation unavailable (no redis connection)' });
        }

        const run = await prisma.crawlRun.findUnique({ where: { id: request.params.id } });
        if (!run) {
          return reply.code(404).send({ error: 'crawl run not found' });
        }

        // cancelled=false means the run had already finished (nothing to cancel).
        const cancelled = await cancelCrawlRun(redis, run.id);
        return reply.code(200).send({ cancelled });
      },
    );

    app.post(
      '/sources',
      {
        preHandler: requireAdmin,
        schema: { body: sourceSchema, response: { 201: sourceResponseSchema } },
      },
      async (request, reply) => {
        const source = await prisma.source.create({ data: request.body });
        return reply.code(201).send(source);
      },
    );

    app.post(
      '/sources/:id/crawl',
      {
        preHandler: requireAdmin,
        schema: {
          params: z.object({ id: z.string() }),
          response: {
            202: z.object({ enqueued: z.literal(true), crawlRunId: z.string().optional() }),
            404: z.object({ error: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const source = await prisma.source.findUnique({ where: { id: request.params.id } });
        if (!source) {
          return reply.code(404).send({ error: 'source not found' });
        }

        // With Redis available, open a tracked CrawlRun so progress/completion
        // is observable; the seed URL is reserved for the run before enqueue.
        if (redis) {
          const crawlRunId = await startCrawlRun(source.id);
          await reserveUrlForRun(redis, crawlRunId, source.seedUrl);
          await queues.scrape.add(
            'scrape',
            { sourceId: source.id, url: source.seedUrl, depth: 0, crawlRunId },
            { jobId: scrapeJobId(crawlRunId, source.seedUrl) },
          );
          return reply.code(202).send({ enqueued: true, crawlRunId });
        }

        await queues.scrape.add('scrape', { sourceId: source.id, url: source.seedUrl, depth: 0 });
        return reply.code(202).send({ enqueued: true });
      },
    );
  };
}
