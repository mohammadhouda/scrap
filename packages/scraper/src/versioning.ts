import { prisma } from '@scraper/db';
import { processedPageSchema } from '@scraper/shared';
import { sha256 } from './dedup.js';

export interface PersistVersionInput {
  sourceId: string;
  url: string;
  rawHtml: string;
  cleanedMd: string;
  title: string | null;
  tables?: Array<Array<Record<string, string>>>;
  language?: string | null;
}

export async function getLatestVersion(url: string) {
  const page = await prisma.page.findUnique({
    where: { url },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  return page?.versions[0];
}

export async function touchLastSeen(url: string): Promise<void> {
  await prisma.page.update({ where: { url }, data: { lastSeenAt: new Date() } });
}

export async function persistVersion(input: PersistVersionInput) {
  const processed = processedPageSchema.parse({
    cleanedMd: input.cleanedMd,
    title: input.title,
    tables: input.tables,
    language: input.language ?? null,
  });

  const urlHash = sha256(input.url);

  const page = await prisma.page.upsert({
    where: { url: input.url },
    create: { url: input.url, urlHash, sourceId: input.sourceId },
    update: { lastSeenAt: new Date() },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  const nextVersion = (page.versions[0]?.version ?? 0) + 1;

  return prisma.pageVersion.create({
    data: {
      pageId: page.id,
      version: nextVersion,
      contentHash: sha256(processed.cleanedMd),
      rawHtml: input.rawHtml,
      cleanedMd: processed.cleanedMd,
      title: processed.title,
      tables: processed.tables,
      language: processed.language,
    },
  });
}
