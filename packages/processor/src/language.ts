import { franc } from 'franc';

export function detectLanguage(text: string): string | null {
  if (!text || text.trim().length < 10) return null;
  const code = franc(text);
  return code === 'und' ? null : code;
}
