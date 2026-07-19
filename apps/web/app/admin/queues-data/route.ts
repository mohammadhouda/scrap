import { NextResponse } from 'next/server';
import { getAdminToken } from '../actions';
import { ApiError, getQueueCounts } from '@/lib/api';

// The admin token lives in an httpOnly cookie (never exposed to client JS),
// so the client-side polling component hits this same-origin route instead
// of calling the Fastify API directly.
export async function GET() {
  const token = await getAdminToken();
  if (!token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const counts = await getQueueCounts(token);
    return NextResponse.json(counts);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    return NextResponse.json({ error: 'failed to load queue counts' }, { status });
  }
}
