import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Loading({ label = 'Loading...', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-12 text-sm text-slate-500', className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ label = 'Nothing here yet.', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 py-12 text-sm text-slate-500',
        className,
      )}
    >
      <Inbox className="h-6 w-6 text-slate-300" />
      {label}
    </div>
  );
}

export function ErrorState({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 py-8 text-sm text-red-700',
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5" />
      {message}
    </div>
  );
}
