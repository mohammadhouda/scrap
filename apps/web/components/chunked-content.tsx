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
    return <p className="text-sm text-slate-500">No indexed content for this page yet.</p>;
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
              'scroll-mt-20 rounded-md p-3 transition-colors',
              highlighted && 'bg-amber-100 ring-2 ring-amber-400',
            )}
          >
            {chunk.heading ? (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {chunk.heading}
              </p>
            ) : null}
            {chunk.contentType === 'TABLE' ? (
              <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">
                {chunk.content}
              </pre>
            ) : (
              <div className="prose prose-sm max-w-none text-slate-700">
                <ReactMarkdown>{chunk.content}</ReactMarkdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
