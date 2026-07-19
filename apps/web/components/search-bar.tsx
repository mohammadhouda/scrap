import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SearchBar({ className, defaultValue }: { className?: string; defaultValue?: string }) {
  return (
    <form action="/search" method="GET" className={cn('flex items-center gap-2', className)}>
      <Input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search crawled content..."
        aria-label="Search query"
      />
      <Button type="submit" size="default">
        <Search className="h-4 w-4" />
        Search
      </Button>
    </form>
  );
}
