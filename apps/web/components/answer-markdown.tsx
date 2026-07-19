import Link from 'next/link';
import { Fragment } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import type { Citation } from '@/lib/api';
import { cn } from '@/lib/utils';

const CITATION_PATTERN = /\[(\d+)\]/g;

function splitCitations(
  text: string,
  byNumber: Map<number, Citation>,
  keyPrefix: string,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

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
          key={`${keyPrefix}-c${i++}`}
          href={`/page/${citation.pageId}?chunk=${citation.chunkId}`}
          className="mx-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white align-super !text-zinc-900 text-[10px] font-semibold no-underline transition-colors hover:bg-zinc-300"
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

  return parts;
}

// Walks the React children react-markdown hands each block/inline component
// (strings, and already-rendered elements like <strong>/<em> for nested
// markdown) and turns "[n]" markers found in any string leaf into a citation
// chip -- without disturbing markdown formatting around it.
function withCitations(
  node: React.ReactNode,
  byNumber: Map<number, Citation>,
  keyPrefix: string,
): React.ReactNode {
  if (typeof node === 'string') {
    return splitCitations(node, byNumber, keyPrefix);
  }
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <Fragment key={`${keyPrefix}-${i}`}>{withCitations(child, byNumber, `${keyPrefix}-${i}`)}</Fragment>
    ));
  }
  return node;
}

export function AnswerMarkdown({
  text,
  citations,
  streaming,
  className,
}: {
  text: string;
  citations: Citation[];
  streaming?: boolean;
  className?: string;
}) {
  const byNumber = new Map(citations.map((c) => [c.n, c]));
  const cite = (children: React.ReactNode, key: string) => withCitations(children, byNumber, key);

  const components: Components = {
    p: ({ children }) => <p>{cite(children, 'p')}</p>,
    li: ({ children }) => <li>{cite(children, 'li')}</li>,
    strong: ({ children }) => <strong>{cite(children, 'strong')}</strong>,
    em: ({ children }) => <em>{cite(children, 'em')}</em>,
    blockquote: ({ children }) => <blockquote>{cite(children, 'bq')}</blockquote>,
    td: ({ children }) => <td>{cite(children, 'td')}</td>,
  };

  return (
    <div
      className={cn(
        'prose prose-sm prose-invert max-w-none',
        'prose-p:leading-relaxed prose-p:text-zinc-200',
        'prose-headings:text-zinc-50 prose-strong:text-zinc-50 prose-a:text-zinc-100',
        'prose-li:text-zinc-200 prose-code:text-zinc-200 prose-code:before:content-none prose-code:after:content-none',
        'prose-pre:border prose-pre:border-zinc-800 prose-pre:bg-zinc-950',
        streaming && 'stream-cursor',
        className,
      )}
    >
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  );
}
