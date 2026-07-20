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
import type { Redis } from 'ioredis';
import type { Asker, Embedder } from '@scraper/rag';
import { createRateLimiter } from './rate-limit.js';
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
  /** Optional — enables the per-IP rate limiter on cost-bearing routes when present. */
  redis?: Redis;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Restrict CORS to an explicit allowlist in production (CORS_ORIGIN, comma-
  // separated). With none set, fall back to reflecting the request origin so
  // local dev keeps working — but a deployed instance should always pin this.
  const allowlist = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: allowlist.length > 0 ? allowlist : true,
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Distributed RAG Scraper API', version: '0.1.0' },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.register(sourcesRoutes(deps.queues, deps.redis));
  await app.register(pagesRoutes());
  await app.register(adminRoutes(deps.queues));

  // The two routes that spend money per request get an IP rate limiter,
  // scoped so admin/read routes are unaffected.
  const rateLimit = createRateLimiter(deps.redis);
  await app.register(async (metered) => {
    metered.addHook('onRequest', rateLimit);
    await metered.register(searchRoutes(deps.embedTexts));
    await metered.register(askRoutes(deps.ask));
  });

  return app;
}
