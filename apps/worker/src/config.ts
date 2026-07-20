const DEFAULT_CONCURRENCY = 5;

function parseConcurrency(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CONCURRENCY;
}

export const WORKER_CONCURRENCY = parseConcurrency(process.env.WORKER_CONCURRENCY);
