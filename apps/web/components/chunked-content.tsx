'use client';

import { useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Chunk } from '@/lib/api';
import { cn } from '@/lib/utils';

export function ChunkedContent({
  chunks,
  highlightChunkId,
}: {
  chunks: Chunk[];
  highlightChunkId?: string;
}) {
  useEffect(() => {
    if (!highlightChunkId) return;
    const el = document.getElementById(`chunk-${highlightChunkId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightChunkId]);

  if (chunks.length === 0) {
    return <p className="text-sm text-zinc-500">No indexed content for this page yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {chunks.map((chunk) => {
        const highlighted = chunk.id === highlightChunkId;
        return (
          <div
            key={chunk.id}
            id={`chunk-${chunk.id}`}
            className={cn(
              'scroll-mt-24 rounded-xl border border-transparent p-4 transition-colors duration-300',
              highlighted
                ? 'border-amber-500/30 bg-amber-500/[0.06] ring-1 ring-amber-500/20'
                : 'hover:bg-zinc-900/40',
            )}
          >
            {chunk.heading ? (
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {chunk.heading}
              </p>
            ) : null}
            {chunk.contentType === 'TABLE' ? (
              <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 font-mono text-xs text-zinc-300">
                {chunk.content}
              </pre>
            ) : (
              <div className="prose prose-sm prose-invert max-w-none prose-p:text-zinc-300 prose-headings:text-zinc-100 prose-strong:text-zinc-100 prose-a:text-zinc-100">
                <ReactMarkdown>{chunk.content}</ReactMarkdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
