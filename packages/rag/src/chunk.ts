import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getEncoding } from 'js-tiktoken';

const encoding = getEncoding('cl100k_base');

function countTokens(text: string): number {
  return encoding.encode(text).length;
}

const CHUNK_SIZE_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 150;
// Tables bypass the recursive splitter, so cap them explicitly. A single huge
// table would otherwise become one chunk that can exceed the embedding model's
// 8191-token input limit and fail the whole index job. 800 keeps table chunks
// uniform with prose and well under that ceiling.
const MAX_TABLE_TOKENS = CHUNK_SIZE_TOKENS;

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
// Fenced code blocks are tracked so a `# comment` line inside a ``` / ~~~ fence
// isn't mistaken for a Markdown heading — critical for code-heavy pages (MDN),
// where that bug would split mid-code-sample and mislabel headings.
function splitByHeadings(markdown: string): HeadingSection[] {
  const lines = markdown.split('\n');
  const sections: HeadingSection[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const content = buffer.join('\n').trim();
    if (content) sections.push({ heading, content });
    buffer = [];
  };

  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!.replace(/[^`~]/g, '');
      // Opening fence records its marker; a matching (same-char) fence closes it.
      if (fence === null) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
      buffer.push(line);
      continue;
    }

    const match = fence === null ? /^(#{1,3})\s+(.+)$/.exec(line) : null;
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

function makeTableChunk(caption: string, rows: string[]): Omit<ChunkResult, 'index'> {
  const content = [caption, ...rows].join('\n');
  return {
    heading: null,
    content,
    contentType: 'TABLE' as const,
    tokenCount: countTokens(content),
  };
}

function chunkTables(tables: TableData[], title: string | null): Array<Omit<ChunkResult, 'index'>> {
  const caption = title ? `Table (${title}):` : 'Table:';
  const captionTokens = countTokens(caption);
  const results: Array<Omit<ChunkResult, 'index'>> = [];

  for (const table of tables) {
    if (table.length === 0) continue;

    const rows = table.map((row) =>
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', '),
    );

    // Pack rows into chunks that stay under MAX_TABLE_TOKENS, repeating the
    // caption on each so every table chunk is self-describing. A single row
    // larger than the budget still ships as its own chunk (best effort).
    let batch: string[] = [];
    let batchTokens = captionTokens;

    for (const row of rows) {
      const rowTokens = countTokens(row) + 1;
      if (batch.length > 0 && batchTokens + rowTokens > MAX_TABLE_TOKENS) {
        results.push(makeTableChunk(caption, batch));
        batch = [];
        batchTokens = captionTokens;
      }
      batch.push(row);
      batchTokens += rowTokens;
    }

    if (batch.length > 0) results.push(makeTableChunk(caption, batch));
  }

  return results;
}

export async function chunkPage(input: ChunkPageInput): Promise<ChunkResult[]> {
  const prose = await chunkProse(input.cleanedMd);
  const tables = chunkTables(input.tables, input.title);
  return [...prose, ...tables].map((chunk, index) => ({ ...chunk, index }));
}
