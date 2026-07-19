import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getEncoding } from 'js-tiktoken';

const encoding = getEncoding('cl100k_base');

function countTokens(text: string): number {
  return encoding.encode(text).length;
}

const CHUNK_SIZE_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 150;

export type TableData = Array<Record<string, string>>;

export type ChunkContentType = 'PROSE' | 'TABLE' | 'CODE' | 'LIST';

export interface ChunkResult {
  index: number;
  heading: string | null;
  content: string;
  contentType: ChunkContentType;
  tokenCount: number;
}

export interface ChunkPageInput {
  cleanedMd: string;
  title: string | null;
  tables: TableData[];
}

interface HeadingSection {
  heading: string | null;
  content: string;
}

// Hand-rolled instead of a library MarkdownHeaderTextSplitter (JS LangChain
// doesn't ship an equivalent that retains heading metadata per section).
function splitByHeadings(markdown: string): HeadingSection[] {
  const lines = markdown.split('\n');
  const sections: HeadingSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push({ heading, content });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]?.trim() ?? null;
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

async function chunkProse(cleanedMd: string): Promise<Array<Omit<ChunkResult, 'index'>>> {
  const sections = splitByHeadings(cleanedMd);
  const splitter = RecursiveCharacterTextSplitter.fromLanguage('markdown', {
    chunkSize: CHUNK_SIZE_TOKENS,
    chunkOverlap: CHUNK_OVERLAP_TOKENS,
    lengthFunction: countTokens,
  });

  const results: Array<Omit<ChunkResult, 'index'>> = [];
  for (const section of sections) {
    const pieces = await splitter.splitText(section.content);
    for (const piece of pieces) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      results.push({
        heading: section.heading,
        content: trimmed,
        contentType: 'PROSE',
        tokenCount: countTokens(trimmed),
      });
    }
  }
  return results;
}

function chunkTables(tables: TableData[], title: string | null): Array<Omit<ChunkResult, 'index'>> {
  const caption = title ? `Table (${title}):` : 'Table:';

  return tables
    .filter((table) => table.length > 0)
    .map((table) => {
      const rows = table.map((row) =>
        Object.entries(row)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', '),
      );
      const content = [caption, ...rows].join('\n');
      return {
        heading: null,
        content,
        contentType: 'TABLE' as const,
        tokenCount: countTokens(content),
      };
    });
}

export async function chunkPage(input: ChunkPageInput): Promise<ChunkResult[]> {
  const prose = await chunkProse(input.cleanedMd);
  const tables = chunkTables(input.tables, input.title);
  return [...prose, ...tables].map((chunk, index) => ({ ...chunk, index }));
}
