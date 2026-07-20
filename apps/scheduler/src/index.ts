import { Redis } from 'ioredis';
import { reconcileStaleRuns } from '@scraper/scraper/crawl-run';

// How often to sweep for stuck crawl runs, and how long a run's heartbeat may
// go silent before it's considered stuck. Both env-overridable.
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS ?? 5 * 60 * 1000);
const STALE_AFTER_MS = Number(process.env.CRAWL_STALE_AFTER_MS ?? 30 * 60 * 1000);

const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

async function sweep(): Promise<void> {
  try {
    const reconciled = await reconcileStaleRuns(connection, { staleAfterMs: STALE_AFTER_MS });
    if (reconciled > 0) {
      console.log(`reconciled ${reconciled} stale crawl run(s)`);
    }
  } catch (err) {
    console.error('stale-run reconcile failed', err);
  }
}

console.log(
  `scheduler up — reconciling stale crawl runs every ${RECONCILE_INTERVAL_MS}ms (stale after ${STALE_AFTER_MS}ms)`,
);

// Run once on boot, then on the interval. unref() so the timer doesn't hold the
// process open on its own during shutdown.
void sweep();
const timer = setInterval(() => void sweep(), RECONCILE_INTERVAL_MS);
timer.unref?.();

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}, stopping scheduler`);
  clearInterval(timer);
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
