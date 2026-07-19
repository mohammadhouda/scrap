import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@scraper/db';
import type { Asker } from '@scraper/rag';

const askBodySchema = z.object({
  question: z.string().min(1),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).optional(),
  source: z.string().optional(),
});

function sseWrite(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function askRoutes(ask: Asker): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.post('/ask', { schema: { body: askBodySchema } }, async (request, reply) => {
      const { question, mode, source } = request.body;

      let sourceId: string | undefined;
      if (source) {
        const found = await prisma.source.findUnique({ where: { name: source } });
        if (!found) {
          return reply.code(404).send({ error: `unknown source "${source}"` });
        }
        sourceId = found.id;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        const result = await ask(question, { mode, sourceId });
        sseWrite(reply.raw, 'citations', result.citations);

        for await (const token of result.answerStream) {
          sseWrite(reply.raw, 'token', { text: token });
        }

        sseWrite(reply.raw, 'done', {});
      } catch (err) {
        request.log.error(err, 'ask stream failed');
        sseWrite(reply.raw, 'error', { message: 'failed to generate an answer' });
      } finally {
        reply.raw.end();
      }
    });
  };
}
