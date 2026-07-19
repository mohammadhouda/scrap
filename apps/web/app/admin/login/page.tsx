'use client';

import { useState, useTransition } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { login } from '../actions';

export default function AdminLoginPage() {
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError('');
    startTransition(async () => {
      const result = await login(formData);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-center gap-6 pt-16">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-zinc-900">
        <Lock className="h-5 w-5" />
      </span>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Admin login</CardTitle>
          <CardDescription>Enter the admin token to manage sources and queues.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input type="password" name="token" placeholder="Admin token" aria-label="Admin token" required />
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Checking...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
