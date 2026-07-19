import { createAsker, createEmbedder } from '@scraper/rag';
import { buildApp } from './app.js';
import { createQueues } from './queues.js';
import { createRedisConnection } from './redis.js';

const port = Number(process.env.API_PORT ?? 4000);

const connection = createRedisConnection();
const queues = createQueues(connection);
const embedTexts = createEmbedder();
const ask = createAsker({ embedTexts });

const app = await buildApp({ queues, embedTexts, ask });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
