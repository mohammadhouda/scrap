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

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  mode: z.enum(['keyword', 'semantic', 'hybrid']).default('hybrid'),
  source: z.string().optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
