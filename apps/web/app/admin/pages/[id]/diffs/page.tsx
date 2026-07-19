import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getPage, getPageVersions } from '@/lib/api';
import { Empty, ErrorState } from '@/components/ui/state';
import { VersionDiff } from '@/components/admin/version-diff';
import { cn } from '@/lib/utils';

export default async function PageDiffsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { from, to } = await searchParams;

  let page: Awaited<ReturnType<typeof getPage>>;
  let versions: Awaited<ReturnType<typeof getPageVersions>>;

  try {
    [page, versions] = await Promise.all([getPage(id), getPageVersions(id)]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    return <ErrorState message="Could not load version history." />;
  }

  if (versions.length < 2) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-slate-900">Version diffs</h1>
        <p className="truncate text-sm text-slate-500">{page.url}</p>
        <Empty label="This page only has one version -- nothing to diff yet." />
      </div>
    );
  }

  const toVersion = versions.find((v) => String(v.version) === to) ?? versions[0]!;
  const fromVersion =
    versions.find((v) => String(v.version) === from) ??
    versions.find((v) => v.version === toVersion.version - 1) ??
    versions[versions.length - 1]!;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Version diffs</h1>
        <p className="truncate text-sm text-slate-500">{page.url}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Comparing</span>
        {versions.map((v) => (
          <Link
            key={`from-${v.version}`}
            href={`/admin/pages/${id}/diffs?from=${v.version}&to=${toVersion.version}`}
            className={cn(
              'rounded px-2 py-1',
              v.version === fromVersion.version
                ? 'bg-red-100 text-red-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            v{v.version}
          </Link>
        ))}
        <span className="text-slate-500">against</span>
        {versions.map((v) => (
          <Link
            key={`to-${v.version}`}
            href={`/admin/pages/${id}/diffs?from=${fromVersion.version}&to=${v.version}`}
            className={cn(
              'rounded px-2 py-1',
              v.version === toVersion.version
                ? 'bg-green-100 text-green-800'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            v{v.version}
          </Link>
        ))}
      </div>

      <VersionDiff before={fromVersion.cleanedMd} after={toVersion.cleanedMd} />
    </div>
  );
}
