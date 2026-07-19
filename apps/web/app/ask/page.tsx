'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Send } from 'lucide-react';
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Ask a question</h1>
        <p className="text-slate-600">Answers are grounded in the crawled sources with citations.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What do you want to know?"
          aria-label="Question"
        />
        <Button type="submit" disabled={status === 'streaming'}>
          {status === 'streaming' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Ask
        </Button>
      </form>

      {status === 'error' ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {answer ? (
        <Card>
          <CardContent className="pt-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
              <CitationText text={answer} citations={citations} />
            </p>
          </CardContent>
        </Card>
      ) : null}

      {citations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</h2>
          <ul className="flex flex-col gap-2">
            {citations.map((c) => (
              <li key={c.chunkId}>
                <Link
                  href={`/page/${c.pageId}?chunk=${c.chunkId}`}
                  className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                    {c.n}
                  </span>
                  <span className="truncate">{c.title ?? c.url}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
