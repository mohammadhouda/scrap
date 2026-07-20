import { z } from 'zod';

export const sourceSchema = z.object({
  name: z.string().min(1),
  seedUrl: z.string().url(),
  allowPatterns: z.array(z.string()).default([]),
  denyPatterns: z.array(z.string()).default([]),
  renderJs: z.boolean().default(false),
  maxDepth: z.number().int().min(0).default(3),
  ratePerSecond: z.number().positive().default(1.0),
  scheduleCron: z.string().nullable().optional(),
});

export type SourceInput = z.infer<typeof sourceSchema>;

// Cap query length: every semantic/hybrid search embeds `q` via OpenAI (costs
// money), so an unbounded query is a cost-amplification vector.
export const MAX_QUERY_LENGTH = 1000;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(MAX_QUERY_LENGTH),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid'),
  source: z.string().optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const processedPageSchema = z.object({
  cleanedMd: z.string().min(1),
  title: z.string().nullable(),
  tables: z.array(z.array(z.record(z.string(), z.string()))).default([]),
  language: z.string().nullable(),
});

export type ProcessedPage = z.infer<typeof processedPageSchema>;
