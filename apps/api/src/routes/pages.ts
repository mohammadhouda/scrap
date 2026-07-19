import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@scraper/db';

const listQuerySchema = z.object({
  source: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pagesRoutes(): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get('/pages', { schema: { querystring: listQuerySchema } }, async (request) => {
      const { source, page, pageSize } = request.query;
      const where = source ? { source: { name: source } } : {};

      const [items, total] = await Promise.all([
        prisma.page.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { firstSeenAt: 'desc' },
          include: { source: { select: { name: true } } },
        }),
        prisma.page.count({ where }),
      ]);

      return { items, total, page, pageSize };
    });

    app.get(
      '/pages/:id/versions',
      { schema: { params: z.object({ id: z.string() }) } },
      async (request, reply) => {
        const page = await prisma.page.findUnique({
          where: { id: request.params.id },
          include: { versions: { orderBy: { version: 'desc' } } },
        });

        if (!page) {
          return reply.code(404).send({ error: 'page not found' });
        }

        return page.versions;
      },
    );
  };
}
