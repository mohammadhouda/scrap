'use client';

import { useState, useTransition } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cancelCrawlAction } from '@/app/admin/actions';

export function CancelCrawlButton({ crawlRunId }: { crawlRunId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');

  function handleClick() {
    setMessage('');
    startTransition(async () => {
      const result = await cancelCrawlAction(crawlRunId);
      if (result?.error) setMessage(result.error);
      else setMessage(result?.cancelled ? 'Crawl cancelled' : 'Already finished');
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={handleClick} disabled={pending}>
        <Ban className="h-3.5 w-3.5" />
        {pending ? 'Cancelling...' : 'Cancel'}
      </Button>
      {message ? <span className="text-xs text-zinc-500">{message}</span> : null}
    </div>
  );
}
