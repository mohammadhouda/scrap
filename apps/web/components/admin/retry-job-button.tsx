'use client';

import { useState, useTransition } from 'react';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { retryJobAction } from '@/app/admin/actions';

export function RetryJobButton({
  jobId,
  queue,
}: {
  jobId: string;
  queue: 'scrape' | 'discover' | 'index';
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');

  function handleClick() {
    setMessage('');
    startTransition(async () => {
      const result = await retryJobAction(jobId, queue);
      setMessage(result?.error ?? 'Retried');
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={handleClick} disabled={pending}>
        <RotateCw className="h-3.5 w-3.5" />
        {pending ? 'Retrying...' : 'Retry'}
      </Button>
      {message ? <span className="text-xs text-zinc-500">{message}</span> : null}
    </div>
  );
}
