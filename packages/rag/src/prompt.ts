export interface PromptSource {
  n: number;
  url: string;
  title: string | null;
  heading: string | null;
  content: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

const SYSTEM_PROMPT = [
  'You answer questions using ONLY the provided sources. Cite every claim',
  'with [n] where n is the source index. If the sources do not contain the answer,',
  'say so. Do not invent sources or facts.',
].join('\n');

// Every LLM prompt in this project goes through this single function -- no
// ad-hoc prompts in route handlers (see plan.md section 11).
export function buildPrompt(question: string, sources: PromptSource[]): BuiltPrompt {
  const sourcesText = sources
    .map(
      (s) =>
        `[${s.n}] URL: ${s.url} | Title: ${s.title ?? 'Untitled'} | Heading: ${s.heading ?? 'N/A'}\n${s.content}`,
    )
    .join('\n\n');

  const user = `${question}\n\nSources:\n${sourcesText}`;

  return { system: SYSTEM_PROMPT, user };
}

// Post-processes an LLM answer to find which [n] citation markers it
// actually used, so the caller can filter the candidate source pool down to
// only the ones cited (see plan.md section 7, "Citation extraction").
export function extractCitedIndices(answer: string): number[] {
  const matches = answer.matchAll(/\[(\d+)\]/g);
  const indices = new Set<number>();
  for (const match of matches) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > 0) indices.add(n);
  }
  return [...indices].sort((a, b) => a - b);
}
