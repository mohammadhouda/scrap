'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { AnswerMarkdown } from '@/components/answer-markdown';
import { readSseStream } from '@/lib/sse';
import type { Citation } from '@/lib/api';

type Status = 'idle' | 'streaming' | 'done' | 'error';

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [citedIndices, setCitedIndices] = useState<number[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || status === 'streaming') return;

    setAskedQuestion(question.trim());
    setAnswer('');
    setCitations([]);
    setCitedIndices(null);
    setErrorMessage('');
    setStatus('streaming');

    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
      const response = await fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      for await (const event of readSseStream(response)) {
        if (event.event === 'citations') {
          setCitations(JSON.parse(event.data) as Citation[]);
        } else if (event.event === 'citations-used') {
          const { indices } = JSON.parse(event.data) as { indices: number[] };
          setCitedIndices(indices);
        } else if (event.event === 'token') {
          const { text } = JSON.parse(event.data) as { text: string };
          setAnswer((prev) => prev + text);
        } else if (event.event === 'error') {
          const { message } = JSON.parse(event.data) as { message: string };
          setErrorMessage(message);
          setStatus('error');
          return;
        } else if (event.event === 'done') {
          setStatus('done');
        }
      }
    } catch {
      setErrorMessage('Failed to reach the API.');
      setStatus('error');
    }
  }

  const idle = status === 'idle' && !answer;

  return (
    <div className="flex flex-col gap-8">
      {idle ? (
        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-medium text-zinc-400">
            <Sparkles className="h-3 w-3" />
            Grounded in your crawled sources
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Ask a question</h1>
          <p className="text-zinc-400">Every claim in the answer is cited — click a number to verify it.</p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-2xl items-center gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What do you want to know?"
          aria-label="Question"
          className="h-11"
        />
        <Button type="submit" size="lg" disabled={status === 'streaming'}>
          {status === 'streaming' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Ask
        </Button>
      </form>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {askedQuestion ? (
          <p className="self-end rounded-2xl rounded-tr-sm bg-zinc-800/80 px-4 py-2 text-sm text-zinc-200">
            {askedQuestion}
          </p>
        ) : null}

        {status === 'error' ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4 text-sm text-red-400">
            {errorMessage}
          </div>
        ) : null}

        {status === 'streaming' && !answer ? (
          <div className="flex items-center gap-2 px-1 text-sm text-zinc-500">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900">
              <Sparkles className="h-3 w-3" />
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
            </span>
          </div>
        ) : null}

        {answer ? (
          <div className="flex animate-slide-up flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-zinc-900">
                <Sparkles className="h-3 w-3" />
              </span>
              <span className="text-xs font-medium text-zinc-500">
                {status === 'streaming' ? 'Answering…' : 'Answer'}
              </span>
            </div>
            <Card>
              <CardContent className="pt-5">
                <AnswerMarkdown text={answer} citations={citations} streaming={status === 'streaming'} />
              </CardContent>
            </Card>
          </div>
        ) : null}

        {citations.length > 0 ? (
          <SourceList citations={citations} citedIndices={citedIndices} />
        ) : null}
      </div>
    </div>
  );
}

// While streaming (citedIndices === null) every retrieved source is listed.
// Once the answer is complete, the sources the model actually cited stay at
// full strength and the rest collapse under a quieter "also retrieved"
// section — retrieved-but-uncited context is still inspectable, but no longer
// masquerades as evidence for the answer.
function SourceList({
  citations,
  citedIndices,
}: {
  citations: Citation[];
  citedIndices: number[] | null;
}) {
  const cited =
    citedIndices === null ? citations : citations.filter((c) => citedIndices.includes(c.n));
  const uncited =
    citedIndices === null ? [] : citations.filter((c) => !citedIndices.includes(c.n));

  return (
    <div className="flex flex-col gap-2 animate-slide-up">
      {cited.length > 0 ? (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {citedIndices === null ? 'Sources' : 'Cited sources'}
          </h2>
          <ul className="flex flex-col gap-2">
            {cited.map((c) => (
              <SourceItem key={c.chunkId} citation={c} />
            ))}
          </ul>
        </>
      ) : null}
      {uncited.length > 0 ? (
        <>
          <h2 className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Retrieved but not cited
          </h2>
          <ul className="flex flex-col gap-2 opacity-60">
            {uncited.map((c) => (
              <SourceItem key={c.chunkId} citation={c} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SourceItem({ citation: c }: { citation: Citation }) {
  return (
    <li>
      <Link
        href={`/page/${c.pageId}?chunk=${c.chunkId}`}
        className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-sm transition-colors hover:border-zinc-700 hover:bg-zinc-800/60"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-zinc-900">
          {c.n}
        </span>
        <span className="truncate text-zinc-300">{c.title ?? c.url}</span>
      </Link>
    </li>
  );
}
