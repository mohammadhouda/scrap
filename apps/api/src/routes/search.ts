import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@scraper/db';
import { hybridSearch, keywordSearch, semanticSearch, type Embedder } from '@scraper/rag';
import { searchQuerySchema } from '@scraper/shared';

export function searchRoutes(embedTexts: Embedder): FastifyPluginAsync {
  return async (rawApp) => {
    const app = rawApp.withTypeProvider<ZodTypeProvider>();

    app.get('/search', { schema: { querystring: searchQuerySchema } }, async (request, reply) => {
      const { q, mode, source } = request.query;

      let sourceId: string | undefined;
      if (source) {
        const found = await prisma.source.findUnique({ where: { name: source } });
        if (!found) {
          return reply.code(404).send({ error: `unknown source "${source}"` });
        }
        sourceId = found.id;
      }

      const options = { sourceId };
      const results =
        mode === 'semantic'
          ? await semanticSearch(embedTexts, q, options)
          : mode === 'keyword'
            ? await keywordSearch(q, options)
            : await hybridSearch(embedTexts, q, options);

      return { mode, results };
    });
  };
}
