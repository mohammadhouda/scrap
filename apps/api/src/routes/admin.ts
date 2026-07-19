import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import type { Queues } from '../queues.js';

const queueNameSchema = z.enum(['scrape', 'discover', 'index']);
const queueQuerySchema = z.object({ queue: queueNameSchema.default('scrape') });

export function adminRoutes(queues: Queues): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();
    app.addHook('preHandler', requireAdmin);

    app.get('/admin/queues', async () => {
      const names = queueNameSchema.options;
      return Promise.all(
        names.map(async (name) => ({
          name,
          counts: await queues[name].getJobCounts('wait', 'active', 'completed', 'failed', 'delayed'),
        })),
      );
    });

    app.get('/admin/dlq', { schema: { querystring: queueQuerySchema } }, async (request) => {
      const failed = await queues[request.query.queue].getFailed(0, 100);
      return failed.map((job) => ({
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp,
      }));
    });

    app.post(
      '/admin/dlq/:id/retry',
      {
        schema: {
          params: z.object({ id: z.string() }),
          querystring: queueQuerySchema,
        },
      },
      async (request, reply) => {
        const job = await queues[request.query.queue].getJob(request.params.id);
        if (!job) {
          return reply.code(404).send({ error: 'job not found' });
        }
        await job.retry();
        return { retried: true };
      },
    );
  };
}
