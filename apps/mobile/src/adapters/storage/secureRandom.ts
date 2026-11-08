import type { RandomSource } from '@wmbugo/core';

/**
 * CSPRNG from the platform (Hermes exposes crypto.getRandomValues through the
 * react-native-get-random-values polyfill, imported in index.js). There is no
 * fallback to Math.random: with no secure source the key cannot be created.
 */
export const secureRandom: RandomSource = {
  bytes(length: number): Uint8Array {
    const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (!c?.getRandomValues) throw new Error('no secure random source');
    return c.getRandomValues(new Uint8Array(length));
  },
};
