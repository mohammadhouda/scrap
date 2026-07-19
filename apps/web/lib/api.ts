export interface Source {
  id: string;
  name: string;
  seedUrl: string;
  allowPatterns: string[];
  denyPatterns: string[];
  renderJs: boolean;
  maxDepth: number;
  ratePerSecond: number;
  scheduleCron: string | null;
  createdAt: string;
}

export interface Page {
  id: string;
  sourceId: string;
  url: string;
  urlHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  source: { name: string };
}

export interface Chunk {
  id: string;
  index: number;
  heading: string | null;
  content: string;
  contentType: 'PROSE' | 'TABLE' | 'CODE' | 'LIST';
  tokenCount: number;
}

export interface PageVersion {
  id: string;
  pageId: string;
  version: number;
  contentHash: string;
  rawHtml: string;
  cleanedMd: string;
  title: string | null;
  language: string | null;
  tables: unknown;
  fetchedAt: string;
  chunks: Chunk[];
}

export interface SearchResult {
  chunkId: string;
  pageId: string;
  content: string;
  heading: string | null;
  url: string;
  title: string | null;
  sourceId: string;
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface Citation {
  n: number;
  url: string;
  title: string | null;
  chunkId: string;
  pageId: string;
}

export interface QueueCount {
  name: 'scrape' | 'discover' | 'index';
  counts: {
    wait: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export interface DlqJob {
  id: string;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function resolveBaseUrl(): string {
  if (typeof window === 'undefined') {
    // Server-side (SSR/RSC): prefer the internal Docker-network URL when set.
    return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { adminToken?: string } = {},
): Promise<T> {
  const { adminToken, ...rest } = init;
  const base = resolveBaseUrl();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string> | undefined),
  };
  if (adminToken) {
    headers.Authorization = `Bearer ${adminToken}`;
  }

  const response = await fetch(`${base}${path}`, { ...rest, headers, cache: 'no-store' });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // response body wasn't JSON; fall back to statusText
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getSources(): Promise<Source[]> {
  return apiFetch('/sources');
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function getPages(params: { source?: string; page?: number; pageSize?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.source) qs.set('source', params.source);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiFetch<PagedResult<Page>>(`/pages${suffix}`);
}

export function getPage(id: string): Promise<Page> {
  return apiFetch(`/pages/${id}`);
}

export function getPageVersions(id: string): Promise<PageVersion[]> {
  return apiFetch(`/pages/${id}/versions`);
}

export function search(params: {
  q: string;
  mode?: SearchMode;
  source?: string;
}): Promise<{ mode: SearchMode; results: SearchResult[] }> {
  const qs = new URLSearchParams({ q: params.q });
  if (params.mode) qs.set('mode', params.mode);
  if (params.source) qs.set('source', params.source);
  return apiFetch(`/search?${qs}`);
}

export function createSource(
  adminToken: string,
  data: {
    name: string;
    seedUrl: string;
    allowPatterns?: string[];
    denyPatterns?: string[];
    renderJs?: boolean;
    maxDepth?: number;
    ratePerSecond?: number;
  },
): Promise<Source> {
  return apiFetch('/sources', { method: 'POST', body: JSON.stringify(data), adminToken });
}

export function startCrawl(adminToken: string, sourceId: string): Promise<{ enqueued: true }> {
  return apiFetch(`/sources/${sourceId}/crawl`, { method: 'POST', adminToken });
}

export function getQueueCounts(adminToken: string): Promise<QueueCount[]> {
  return apiFetch('/admin/queues', { adminToken });
}

export function getDlq(
  adminToken: string,
  queue: 'scrape' | 'discover' | 'index' = 'scrape',
): Promise<DlqJob[]> {
  return apiFetch(`/admin/dlq?queue=${queue}`, { adminToken });
}

export function retryDlqJob(
  adminToken: string,
  jobId: string,
  queue: 'scrape' | 'discover' | 'index' = 'scrape',
): Promise<{ retried: true }> {
  return apiFetch(`/admin/dlq/${jobId}/retry?queue=${queue}`, { method: 'POST', adminToken });
}
