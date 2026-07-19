import { diffWords } from 'diff';

export function VersionDiff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);

  return (
    <pre className="whitespace-pre-wrap rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 font-mono text-xs leading-relaxed text-zinc-300">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? 'bg-emerald-500/15 text-emerald-300'
              : part.removed
                ? 'bg-red-500/15 text-red-300 line-through decoration-red-400/60'
                : undefined
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}
