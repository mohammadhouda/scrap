-- CrawlRun heartbeat column. Maintained by a DB trigger (below) rather than
-- Prisma's @updatedAt, so it stays correct for every update path — including
-- raw SQL and clients generated before this column existed. The DB default
-- backfills existing rows and covers inserts.
ALTER TABLE "CrawlRun" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Trigger: set updatedAt = now() on every row update.
CREATE OR REPLACE FUNCTION set_crawlrun_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER crawlrun_set_updated_at
  BEFORE UPDATE ON "CrawlRun"
  FOR EACH ROW
  EXECUTE FUNCTION set_crawlrun_updated_at();

-- Supports the reconciler's lookup of stale RUNNING runs.
CREATE INDEX "CrawlRun_status_updatedAt_idx" ON "CrawlRun" ("status", "updatedAt");
