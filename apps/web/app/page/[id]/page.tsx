import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getPage, getPageVersions } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/state';
import { ChunkedContent } from '@/components/chunked-content';

export default async function PageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chunk?: string }>;
}) {
  const { id } = await params;
  const { chunk } = await searchParams;

  let page: Awaited<ReturnType<typeof getPage>>;
  let versions: Awaited<ReturnType<typeof getPageVersions>>;

  try {
    [page, versions] = await Promise.all([getPage(id), getPageVersions(id)]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    return <ErrorState message="Could not load this page. Is the API running?" />;
  }

  const latest = versions[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-slate-900">{latest?.title ?? page.url}</h1>
          <Badge variant="secondary">{page.source.name}</Badge>
          {latest ? <Badge variant="secondary">v{latest.version}</Badge> : null}
          {latest?.language ? <Badge variant="secondary">{latest.language}</Badge> : null}
        </div>
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-xs text-slate-500 hover:underline"
        >
          {page.url}
        </a>
        {versions.length > 1 ? (
          <Link href={`/admin/pages/${page.id}/diffs`} className="text-xs text-blue-600 hover:underline">
            View {versions.length} versions and diffs →
          </Link>
        ) : null}
      </div>

      {latest ? (
        <ChunkedContent chunks={latest.chunks} highlightChunkId={chunk} />
      ) : (
        <p className="text-sm text-slate-500">No versions recorded yet.</p>
      )}
    </div>
  );
}
