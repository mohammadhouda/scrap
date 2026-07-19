import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SearchBar({ className, defaultValue }: { className?: string; defaultValue?: string }) {
  return (
    <form
      action="/search"
      method="GET"
      className={cn(
        'flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1.5 pl-4 shadow-sm shadow-black/20 transition-colors focus-within:border-zinc-600',
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0 text-zinc-500" />
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search crawled content..."
        aria-label="Search query"
        className="h-8 w-full flex-1 bg-transparent px-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
      />
      <Button type="submit" size="sm" className="shrink-0">
        Search
      </Button>
    </form>
  );
}
