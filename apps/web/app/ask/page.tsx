'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { CitationText } from '@/components/citation-text';
import { readSseStream } from '@/lib/sse';
import type { Citation } from '@/lib/api';

type Status = 'idle' | 'streaming' | 'done' | 'error';

export default function AskPage() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || status === 'streaming') return;

    setAnswer('');
    setCitations([]);
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs font-medium text-zinc-400">
          <Sparkles className="h-3 w-3" />
          Grounded in your crawled sources
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Ask a question</h1>
        <p className="text-zinc-400">Every claim in the answer is cited — click a number to verify it.</p>
      </div>

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

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {status === 'error' ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-4 text-sm text-red-400">
            {errorMessage}
          </div>
        ) : null}

        {status === 'streaming' && !answer ? (
          <div className="flex items-center gap-1.5 px-1 text-sm text-zinc-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
            <span className="ml-1">Thinking...</span>
          </div>
        ) : null}

        {answer ? (
          <Card className="animate-slide-up">
            <CardContent className="pt-5">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">
                <CitationText text={answer} citations={citations} />
              </p>
            </CardContent>
          </Card>
        ) : null}

        {citations.length > 0 ? (
          <div className="flex flex-col gap-2 animate-slide-up">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sources</h2>
            <ul className="flex flex-col gap-2">
              {citations.map((c) => (
                <li key={c.chunkId}>
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
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
