import Link from 'next/link';
import type { Citation } from '@/lib/api';

const CITATION_PATTERN = /\[(\d+)\]/g;

// Renders LLM answer text, turning inline "[n]" markers into links that jump
// to and highlight the cited chunk on its source page.
export function CitationText({ text, citations }: { text: string; citations: Citation[] }) {
  const byNumber = new Map(citations.map((c) => [c.n, c]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITATION_PATTERN.lastIndex = 0;
  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    const [full, numStr] = match;
    const n = Number(numStr);
    const citation = byNumber.get(n);

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (citation) {
      parts.push(
        <Link
          key={`${n}-${match.index}`}
          href={`/page/${citation.pageId}?chunk=${citation.chunkId}`}
          className="mx-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-zinc-900 align-super transition-colors hover:bg-zinc-300"
          title={citation.title ?? citation.url}
        >
          {n}
        </Link>,
      );
    } else {
      parts.push(full);
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
