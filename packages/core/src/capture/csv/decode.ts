/**
 * Byte decoding for bank CSV files (Story 9.1, IMP-001). Pure TypeScript: Hermes does not promise a full `TextDecoder`, and a bank
 * file is as likely to be Windows-1252 as UTF-8, so decoding is done here and is exact for the five encodings the reader names.
 */
export type CsvEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'Windows-1252' | 'ISO-8859-1';

export interface EncodingDetection {
  readonly encoding: CsvEncoding;
  /** 0 to 1. A byte-order mark is near certain; a guess between the two single-byte code pages is not. */
  readonly confidence: number;
  /** Bytes of byte-order mark at the start (0 when none). */
  readonly bomLength: number;
}

/** What 0x80 to 0x9F mean in Windows-1252 (the same bytes are control characters in ISO-8859-1). */
const WINDOWS_1252_HIGH: readonly number[] = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** True when the bytes from `start` are well-formed UTF-8: no overlong forms, no surrogates, nothing above U+10FFFF. */
export function isValidUtf8(bytes: Uint8Array, start = 0): boolean {
  let i = start;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    // The lead byte says how many continuation bytes follow and the smallest code point that length may carry (no overlong forms).
    let need: number;
    let min: number;
    if (b >= 0xc2 && b <= 0xdf) [need, min] = [1, 0x80];
    else if (b >= 0xe0 && b <= 0xef) [need, min] = [2, 0x800];
    else if (b >= 0xf0 && b <= 0xf4) [need, min] = [3, 0x10000];
    else return false;
    let cp = b & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    i += need + 1;
  }
  return true;
}

/** Decodes well-formed UTF-8 (call `isValidUtf8` first). Built in chunks, so a 20 MB file does not blow the argument limit. */
function decodeUtf8(bytes: Uint8Array, start: number): string {
  const parts: string[] = [];
  let units: number[] = [];
  const flush = () => {
    if (units.length > 0) parts.push(String.fromCharCode(...units));
    units = [];
  };
  let i = start;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i]!;
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      i += 4;
    }
    if (cp >= 0x10000) {
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    } else units.push(cp);
    if (units.length >= 8192) flush();
  }
  flush();
  return parts.join('');
}

function decodeUtf16(bytes: Uint8Array, start: number, littleEndian: boolean): string {
  const parts: string[] = [];
  let units: number[] = [];
  for (let i = start; i + 1 < bytes.length; i += 2) {
    units.push(littleEndian ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!);
    if (units.length >= 8192) {
      parts.push(String.fromCharCode(...units));
      units = [];
    }
  }
  if (units.length > 0) parts.push(String.fromCharCode(...units));
  return parts.join('');
}

function decodeSingleByte(bytes: Uint8Array, start: number, windows1252: boolean): string {
  const parts: string[] = [];
  let units: number[] = [];
  for (let i = start; i < bytes.length; i++) {
    const b = bytes[i]!;
    units.push(windows1252 && b >= 0x80 && b <= 0x9f ? WINDOWS_1252_HIGH[b - 0x80]! : b);
    if (units.length >= 8192) {
      parts.push(String.fromCharCode(...units));
      units = [];
    }
  }
  if (units.length > 0) parts.push(String.fromCharCode(...units));
  return parts.join('');
}

function bomOf(bytes: Uint8Array): { encoding: CsvEncoding; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'UTF-8', length: 3 };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'UTF-16LE', length: 2 };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'UTF-16BE', length: 2 };
  return null;
}

/**
 * Finds the encoding: a byte-order mark first; then UTF-16 without one (every other byte is zero); then UTF-8 when the bytes are
 * well-formed; otherwise a single-byte page, where ISO-8859-1 is chosen only when no byte in 0x80 to 0x9F appears (those bytes are
 * printable only in Windows-1252: curly quotes, dashes, the euro sign).
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  const bom = bomOf(bytes);
  if (bom) return { encoding: bom.encoding, confidence: 0.99, bomLength: bom.length };
  const sample = Math.min(bytes.length, 4096);
  if (sample >= 4) {
    let zeroEven = 0;
    let zeroOdd = 0;
    for (let i = 0; i < sample; i++) {
      if (bytes[i] !== 0) continue;
      if (i % 2 === 0) zeroEven++;
      else zeroOdd++;
    }
    const half = sample / 2;
    if (zeroOdd / half > 0.3 && zeroEven / half < 0.05) return { encoding: 'UTF-16LE', confidence: 0.8, bomLength: 0 };
    if (zeroEven / half > 0.3 && zeroOdd / half < 0.05) return { encoding: 'UTF-16BE', confidence: 0.8, bomLength: 0 };
  }
  let ascii = true;
  let highControl = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b >= 0x80) ascii = false;
    if (b >= 0x80 && b <= 0x9f) highControl = true;
  }
  if (ascii) return { encoding: 'UTF-8', confidence: 0.99, bomLength: 0 };
  if (isValidUtf8(bytes)) return { encoding: 'UTF-8', confidence: 0.95, bomLength: 0 };
  return highControl ? { encoding: 'Windows-1252', confidence: 0.85, bomLength: 0 } : { encoding: 'ISO-8859-1', confidence: 0.6, bomLength: 0 };
}

/**
 * Decodes the bytes as the given encoding. A byte-order mark that matches the encoding is stripped; one that does not (an override
 * of a file's own mark) is left as the characters it decodes to.
 */
export function decodeCsvBytes(bytes: Uint8Array, encoding: CsvEncoding): string {
  const bom = bomOf(bytes);
  const start = bom && bom.encoding === encoding ? bom.length : 0;
  switch (encoding) {
    case 'UTF-8':
      // An invalid sequence under an explicit UTF-8 choice falls back to the page that can read every byte.
      return isValidUtf8(bytes, start) ? decodeUtf8(bytes, start) : decodeSingleByte(bytes, start, true);
    case 'UTF-16LE':
      return decodeUtf16(bytes, start, true);
    case 'UTF-16BE':
      return decodeUtf16(bytes, start, false);
    case 'Windows-1252':
      return decodeSingleByte(bytes, start, true);
    case 'ISO-8859-1':
      return decodeSingleByte(bytes, start, false);
  }
}
