const HEADER_CHARSET_RE = /charset\s*=\s*["']?([\w-]+)/i;

const META_CHARSET_RE = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i;
const META_SNIFF_BYTES = 1024;

export function detectCharset(contentType: string | null, bytes: Uint8Array): string {
  const fromHeader = contentType?.match(HEADER_CHARSET_RE)?.[1];
  if (fromHeader) return fromHeader;

  if (bytes.length >= 2) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  }

  const prefix = new TextDecoder('latin1').decode(bytes.subarray(0, META_SNIFF_BYTES));
  const fromMeta = prefix.match(META_CHARSET_RE)?.[1];
  if (fromMeta) return fromMeta;

  return 'utf-8';
}

export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const charset = detectCharset(contentType, bytes);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    // Unknown/unsupported label — decode as UTF-8 rather than dropping the page.
    return new TextDecoder().decode(bytes);
  }
}
