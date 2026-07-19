'use client';

import { useState, useTransition } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startCrawlAction } from '@/app/admin/actions';

export function StartCrawlButton({ sourceId }: { sourceId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');

  function handleClick() {
    setMessage('');
    startTransition(async () => {
      const result = await startCrawlAction(sourceId);
      setMessage(result?.error ?? 'Crawl started');
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={handleClick} disabled={pending}>
        <Play className="h-3.5 w-3.5" />
        {pending ? 'Starting...' : 'Start crawl'}
      </Button>
      {message ? <span className="text-xs text-zinc-500">{message}</span> : null}
    </div>
  );
}
