import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowUpRight, GitCompare } from 'lucide-react';
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">
            {latest?.title ?? page.url}
          </h1>
          <Badge variant="secondary">{page.source.name}</Badge>
          {latest ? <Badge variant="secondary">v{latest.version}</Badge> : null}
          {latest?.language ? <Badge variant="secondary">{latest.language}</Badge> : null}
        </div>
        <a
          href={page.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 truncate font-mono text-xs text-zinc-500 hover:text-zinc-300 hover:underline"
        >
          {page.url}
          <ArrowUpRight className="h-3 w-3 shrink-0" />
        </a>
        {versions.length > 1 ? (
          <Link
            href={`/admin/pages/${page.id}/diffs`}
            className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:underline underline-offset-2"
          >
            <GitCompare className="h-3.5 w-3.5" />
            View {versions.length} versions and diffs
          </Link>
        ) : null}
      </div>

      {latest ? (
        <ChunkedContent chunks={latest.chunks} highlightChunkId={chunk} />
      ) : (
        <p className="text-sm text-zinc-500">No versions recorded yet.</p>
      )}
    </div>
  );
}
