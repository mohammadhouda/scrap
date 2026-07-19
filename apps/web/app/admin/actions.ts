'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ApiError,
  createSource as apiCreateSource,
  getQueueCounts,
  retryDlqJob as apiRetryDlqJob,
  startCrawl as apiStartCrawl,
} from '@/lib/api';

const ADMIN_TOKEN_COOKIE = 'admin_token';

export async function getAdminToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(ADMIN_TOKEN_COOKIE)?.value;
}

async function requireAdminToken(): Promise<string> {
  const token = await getAdminToken();
  if (!token) redirect('/admin/login');
  return token;
}

export async function login(formData: FormData): Promise<{ error?: string } | undefined> {
  const token = String(formData.get('token') ?? '').trim();
  if (!token) return { error: 'Token is required.' };

  try {
    await getQueueCounts(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return { error: 'Invalid admin token.' };
    }
    return { error: 'Could not reach the API. Is it running?' };
  }

  const store = await cookies();
  store.set(ADMIN_TOKEN_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/admin');
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_TOKEN_COOKIE);
  redirect('/admin/login');
}

export async function createSourceAction(
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const token = await requireAdminToken();

  const name = String(formData.get('name') ?? '').trim();
  const seedUrl = String(formData.get('seedUrl') ?? '').trim();
  const renderJs = formData.get('renderJs') === 'on';
  const maxDepth = Number(formData.get('maxDepth') ?? 3);
  const ratePerSecond = Number(formData.get('ratePerSecond') ?? 1);

  try {
    await apiCreateSource(token, { name, seedUrl, renderJs, maxDepth, ratePerSecond });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to create source.' };
  }

  revalidatePath('/admin/sources');
  return undefined;
}

export async function startCrawlAction(sourceId: string): Promise<{ error?: string } | undefined> {
  const token = await requireAdminToken();

  try {
    await apiStartCrawl(token, sourceId);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to start crawl.' };
  }

  revalidatePath('/admin/sources');
  return undefined;
}

export async function retryJobAction(
  jobId: string,
  queue: 'scrape' | 'discover' | 'index',
): Promise<{ error?: string } | undefined> {
  const token = await requireAdminToken();

  try {
    await apiRetryDlqJob(token, jobId, queue);
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Failed to retry job.' };
  }

  revalidatePath('/admin/dlq');
  return undefined;
}
