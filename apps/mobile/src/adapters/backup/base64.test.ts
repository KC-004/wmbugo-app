import { fromBase64, toBase64 } from './base64';

describe('base64 (the native bridge carries bytes as text)', () => {
  it('encodes the standard vectors', () => {
    const enc = (s: string) => toBase64(new Uint8Array([...s].map((c) => c.charCodeAt(0))));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('round-trips every length and every byte value', () => {
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(n).map((_, i) => (i * 37 + n) & 255);
      expect(fromBase64(toBase64(b))).toEqual(b);
    }
    const all = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64(toBase64(all))).toEqual(all);
  });

  it('accepts unpadded input and a large buffer, and refuses a bad character', () => {
    expect(fromBase64('Zm9vYg')).toEqual(new Uint8Array([102, 111, 111, 98]));
    const big = new Uint8Array(100_000).map((_, i) => i & 255);
    expect(fromBase64(toBase64(big))).toEqual(big);
    expect(() => fromBase64('Zm9v*g==')).toThrow('Invalid base64');
  });
});
