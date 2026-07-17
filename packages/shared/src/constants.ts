export const QUEUE_NAMES = {
  scrape: 'scrape',
  index: 'index',
  discover: 'discover',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
