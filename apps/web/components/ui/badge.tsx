import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-white text-zinc-900 ring-transparent',
        secondary: 'bg-zinc-800/80 text-zinc-300 ring-zinc-700',
        success: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
        warning: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
        destructive: 'bg-red-500/10 text-red-400 ring-red-500/20',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
