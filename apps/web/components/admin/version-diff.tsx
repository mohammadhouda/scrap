import { diffWords } from 'diff';

export function VersionDiff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);

  return (
    <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-4 text-xs leading-relaxed">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? 'bg-green-100 text-green-800'
              : part.removed
                ? 'bg-red-100 text-red-800 line-through'
                : 'text-slate-700'
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
