import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors duration-150 focus-visible:outline-none focus-visible:border-zinc-600 focus-visible:ring-2 focus-visible:ring-white/10 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
