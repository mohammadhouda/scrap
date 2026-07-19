import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Asker, Embedder } from '@scraper/rag';
import { adminRoutes } from './routes/admin.js';
import { askRoutes } from './routes/ask.js';
import { pagesRoutes } from './routes/pages.js';
import { searchRoutes } from './routes/search.js';
import { sourcesRoutes } from './routes/sources.js';
import type { Queues } from './queues.js';

export interface AppDeps {
  queues: Queues;
  embedTexts: Embedder;
  ask: Asker;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors);
  await app.register(swagger, {
    openapi: {
      info: { title: 'Distributed RAG Scraper API', version: '0.1.0' },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(sourcesRoutes(deps.queues));
  await app.register(pagesRoutes());
  await app.register(searchRoutes(deps.embedTexts));
  await app.register(askRoutes(deps.ask));
  await app.register(adminRoutes(deps.queues));

  return app;
}
