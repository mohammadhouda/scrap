import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@scraper/db';
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

export function sourcesRoutes(queues: Queues): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get(
      '/sources',
      { schema: { response: { 200: z.array(sourceResponseSchema) } } },
      async () => prisma.source.findMany({ orderBy: { createdAt: 'desc' } }),
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
            202: z.object({ enqueued: z.literal(true) }),
            404: z.object({ error: z.string() }),
          },
        },
      },
      async (request, reply) => {
        const source = await prisma.source.findUnique({ where: { id: request.params.id } });
        if (!source) {
          return reply.code(404).send({ error: 'source not found' });
        }

        await queues.scrape.add('scrape', { sourceId: source.id, url: source.seedUrl, depth: 0 });
        return reply.code(202).send({ enqueued: true });
      },
    );
  };
}
