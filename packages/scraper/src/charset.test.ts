import { describe, expect, it } from 'vitest';
import { decodeHtml, detectCharset } from './charset.js';

function latin1Bytes(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));
}

describe('detectCharset', () => {
  it('prefers the Content-Type header charset', () => {
    const bytes = latin1Bytes('<meta charset="utf-8"><p>x</p>');
    expect(detectCharset('text/html; charset=ISO-8859-1', bytes)).toBe('ISO-8859-1');
  });

  it('detects a UTF-16 byte-order mark', () => {
    expect(detectCharset(null, Uint8Array.from([0xff, 0xfe, 0x41, 0x00]))).toBe('utf-16le');
    expect(detectCharset(null, Uint8Array.from([0xfe, 0xff, 0x00, 0x41]))).toBe('utf-16be');
  });

  it('sniffs <meta charset> from the document prefix', () => {
    expect(detectCharset(null, latin1Bytes('<html><meta charset="windows-1252">'))).toBe(
      'windows-1252',
    );
  });

  it('sniffs the http-equiv content-type form', () => {
    const html = '<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">';
    expect(detectCharset(null, latin1Bytes(html))).toBe('Shift_JIS');
  });

  it('falls back to utf-8', () => {
    expect(detectCharset(null, latin1Bytes('<html><p>plain</p>'))).toBe('utf-8');
    expect(detectCharset('text/html', latin1Bytes(''))).toBe('utf-8');
  });
});

describe('decodeHtml', () => {
  it('decodes ISO-8859-1 bytes correctly instead of producing mojibake', () => {
    // "café" in latin1: é = 0xe9, which is invalid as standalone UTF-8.
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]);
    expect(decodeHtml(bytes, 'text/html; charset=iso-8859-1')).toBe('café');
  });

  it('decodes UTF-8 by default', () => {
    const bytes = new TextEncoder().encode('café');
    expect(decodeHtml(bytes, 'text/html')).toBe('café');
  });

  it('falls back to utf-8 for an unsupported charset label', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(decodeHtml(bytes, 'text/html; charset=not-a-real-charset')).toBe('hello');
  });
});
