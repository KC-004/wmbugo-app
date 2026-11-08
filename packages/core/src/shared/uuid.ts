import type { Clock } from './clock';

/** Source of random bytes (a platform adapter supplies a CSPRNG; tests use a seeded one). */
export interface RandomSource {
  bytes(length: number): Uint8Array;
}

const HEX = '0123456789abcdef';

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 15]!;
  return out;
}

/**
 * UUID v7 (RFC 9562): 48-bit Unix ms timestamp, version 7, variant 10, then
 * 74 random bits. `random` must hold at least 10 bytes.
 */
export function uuidV7(timestampMs: number, random: Uint8Array): string {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs >= 2 ** 48) {
    throw new RangeError('uuidV7: timestamp must be a 48-bit non-negative integer');
  }
  if (random.length < 10) throw new RangeError('uuidV7: need 10 random bytes');
  const b = new Uint8Array(16);
  let ts = timestampMs;
  for (let i = 5; i >= 0; i--) {
    b[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }
  for (let i = 0; i < 10; i++) b[6 + i] = random[i]!;
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * ID generator that is strictly increasing even when the clock stands still
 * or steps back: the timestamp used is never lower than the previous one + 0,
 * and equal-millisecond calls advance it by one so ordering is total.
 */
export function createIdGenerator(clock: Clock, random: RandomSource): () => string {
  let last = -1;
  return () => {
    let ts = clock.nowMs();
    if (ts <= last) ts = last + 1;
    last = ts;
    return uuidV7(ts, random.bytes(10));
  };
}

/** Seeded, deterministic RandomSource for tests (mulberry32). Not a CSPRNG. */
export function seededRandom(seed: number): RandomSource {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  };
  return {
    bytes(length: number): Uint8Array {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = next();
      return out;
    },
  };
}
