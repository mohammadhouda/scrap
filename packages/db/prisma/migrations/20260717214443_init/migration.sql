-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('PROSE', 'TABLE', 'CODE', 'LIST');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seedUrl" TEXT NOT NULL,
    "allowPatterns" TEXT[],
    "denyPatterns" TEXT[],
    "renderJs" BOOLEAN NOT NULL DEFAULT false,
    "maxDepth" INTEGER NOT NULL DEFAULT 3,
    "ratePerSecond" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "scheduleCron" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "CrawlStatus" NOT NULL DEFAULT 'RUNNING',
    "pagesQueued" INTEGER NOT NULL DEFAULT 0,
    "pagesDone" INTEGER NOT NULL DEFAULT 0,
    "pagesFailed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageVersion" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawHtml" TEXT NOT NULL,
    "cleanedMd" TEXT NOT NULL,
    "title" TEXT,
    "language" TEXT,
    "tables" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "pageVersionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "contentType" "ChunkType" NOT NULL DEFAULT 'PROSE',
    "tokenCount" INTEGER NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_name_key" ON "Source"("name");

-- CreateIndex
CREATE INDEX "CrawlRun_sourceId_idx" ON "CrawlRun"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_url_key" ON "Page"("url");

-- CreateIndex
CREATE INDEX "Page_sourceId_idx" ON "Page"("sourceId");

-- CreateIndex
CREATE INDEX "Page_urlHash_idx" ON "Page"("urlHash");

-- CreateIndex
CREATE INDEX "PageVersion_contentHash_idx" ON "PageVersion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "PageVersion_pageId_version_key" ON "PageVersion"("pageId", "version");

-- CreateIndex
CREATE INDEX "Chunk_pageVersionId_idx" ON "Chunk"("pageVersionId");

-- AddForeignKey
ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageVersion" ADD CONSTRAINT "PageVersion_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_pageVersionId_fkey" FOREIGN KEY ("pageVersionId") REFERENCES "PageVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
