CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Chunk" ADD COLUMN "embedding" vector(1536);

CREATE INDEX "Chunk_embedding_idx" ON "Chunk" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "Chunk" ADD COLUMN "contentTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

CREATE INDEX "Chunk_contentTsv_idx" ON "Chunk" USING GIN ("contentTsv");
