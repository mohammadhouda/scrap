import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Loading({ label = 'Loading...', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-16 text-sm text-zinc-500',
        className,
      )}
    >
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      {label}
    </div>
  );
}

export function Empty({ label = 'Nothing here yet.', className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 py-16 text-sm text-zinc-500',
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/60">
        <Inbox className="h-5 w-5 text-zinc-500" />
      </div>
      {label}
    </div>
  );
}

export function ErrorState({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] py-12 text-sm text-red-400',
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
        <AlertTriangle className="h-5 w-5 text-red-400" />
      </div>
      {message}
    </div>
  );
}
