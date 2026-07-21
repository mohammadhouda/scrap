import { NextResponse } from 'next/server';
import { getLatestCrawls } from '@/lib/api';

// Same-origin proxy the admin Sources table polls for live crawl progress.
// /crawls/latest is a public API endpoint, so no admin token is needed here.
export async function GET() {
  try {
    const runs = await getLatestCrawls();
    return NextResponse.json(runs);
  } catch {
    return NextResponse.json({ error: 'failed to load crawl status' }, { status: 502 });
  }
}
