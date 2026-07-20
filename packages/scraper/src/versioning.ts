import { Prisma, prisma } from '@scraper/db';
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

export type PersistResult =
  | { status: 'unchanged'; version: number; pageVersionId: string }
  | { status: 'created'; version: number; pageVersionId: string };

// The maximum number of attempts to persist a new version before giving up.
const MAX_VERSION_ATTEMPTS = 4;

function isVersionConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
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

export async function persistVersion(input: PersistVersionInput): Promise<PersistResult> {
  const processed = processedPageSchema.parse({
    cleanedMd: input.cleanedMd,
    title: input.title,
    tables: input.tables,
    language: input.language ?? null,
  });

  const urlHash = sha256(input.url);
  const contentHash = sha256(processed.cleanedMd);

  for (let attempt = 0; attempt < MAX_VERSION_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // upsert both creates the Page on first sight and touches lastSeenAt
        // on the unchanged path — no separate touchLastSeen round trip needed.
        const page = await tx.page.upsert({
          where: { url: input.url },
          create: { url: input.url, urlHash, sourceId: input.sourceId },
          update: { lastSeenAt: new Date() },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        });

        const latest = page.versions[0];
        if (latest?.contentHash === contentHash) {
          return { status: 'unchanged', version: latest.version, pageVersionId: latest.id };
        }

        const created = await tx.pageVersion.create({
          data: {
            pageId: page.id,
            version: (latest?.version ?? 0) + 1,
            contentHash,
            rawHtml: input.rawHtml,
            cleanedMd: processed.cleanedMd,
            title: processed.title,
            tables: processed.tables,
            language: processed.language,
          },
        });

        return { status: 'created', version: created.version, pageVersionId: created.id };
      });
    } catch (err) {
      if (isVersionConflict(err) && attempt < MAX_VERSION_ATTEMPTS - 1) continue;
      throw err;
    }
  }

  // Unreachable: the loop either returns or throws on the final attempt.
  throw new Error(`persistVersion: exhausted ${MAX_VERSION_ATTEMPTS} attempts for ${input.url}`);
}
