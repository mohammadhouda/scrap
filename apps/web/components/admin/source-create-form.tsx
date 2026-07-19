'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSourceAction } from '@/app/admin/actions';

export function SourceCreateForm() {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError('');
    startTransition(async () => {
      const result = await createSourceAction(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        formRef.current?.reset();
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1">
        <label className="text-xs font-medium text-slate-500" htmlFor="name">
          Name
        </label>
        <Input id="name" name="name" placeholder="my-site" required />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <label className="text-xs font-medium text-slate-500" htmlFor="seedUrl">
          Seed URL
        </label>
        <Input id="seedUrl" name="seedUrl" type="url" placeholder="https://example.com/" required />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500" htmlFor="maxDepth">
          Max depth
        </label>
        <Input id="maxDepth" name="maxDepth" type="number" defaultValue={3} min={0} className="w-24" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500" htmlFor="ratePerSecond">
          Rate/sec
        </label>
        <Input
          id="ratePerSecond"
          name="ratePerSecond"
          type="number"
          step="0.1"
          defaultValue={1}
          min={0.1}
          className="w-24"
        />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
        <input type="checkbox" name="renderJs" className="h-4 w-4" />
        JS-rendered
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? 'Adding...' : 'Add source'}
      </Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
