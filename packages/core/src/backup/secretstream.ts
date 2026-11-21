import { chacha20, hchacha } from '@noble/ciphers/chacha';
import { poly1305 } from '@noble/ciphers/_poly1305';
import { sha256 } from '@noble/hashes/sha2';
import type { Crypto, SecretStreamPull, SecretStreamPush, Sha256Stream } from '../ports/crypto';
import { SECRETSTREAM_ABYTES, SECRETSTREAM_HEADER_BYTES } from '../ports/crypto';
import { concat } from './format';

/**
 * libsodium's `crypto_secretstream_xchacha20poly1305`, in pure TypeScript on the ChaCha20 and Poly1305 primitives. The mobile
 * binding of libsodium does not expose the secretstream, and Hermes cannot run libsodium's WebAssembly, so the app uses this
 * implementation; the tests prove it byte-compatible with `libsodium-wrappers-sumo` in both directions, so a backup written by
 * either opens with the other (Story 8.6, AD-10).
 */
const TAG_MESSAGE = 0;
const TAG_FINAL = 3;
const COUNTER_BYTES = 4;
const INONCE_BYTES = 8;
const KEY_BYTES = 32;
const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]); // "expand 32-byte k"

const words = (b: Uint8Array): Uint32Array => {
  const out = new Uint32Array(b.length / 4);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4, true);
  return out;
};

/** HChaCha20: a 32-byte subkey from the key and the first 16 bytes of the stream header. */
function hchacha20(key: Uint8Array, input: Uint8Array): Uint8Array {
  const out = new Uint32Array(8);
  hchacha(SIGMA, words(key), words(input), out);
  const bytes = new Uint8Array(32);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < 8; i++) dv.setUint32(i * 4, out[i]!, true);
  return bytes;
}

const le64 = (n: number): Uint8Array => {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, n >>> 0, true);
  dv.setUint32(4, Math.floor(n / 4294967296), true);
  return b;
};

class State {
  readonly nonce = new Uint8Array(COUNTER_BYTES + INONCE_BYTES);
  constructor(
    readonly k: Uint8Array,
    inonce: Uint8Array,
  ) {
    this.nonce[0] = 1; // the counter starts at 1
    this.nonce.set(inonce, COUNTER_BYTES);
  }

  /** XOR the first 8 bytes of the MAC into the inonce, then increment the little-endian counter. */
  advance(mac: Uint8Array): void {
    for (let i = 0; i < INONCE_BYTES; i++) this.nonce[COUNTER_BYTES + i] = this.nonce[COUNTER_BYTES + i]! ^ mac[i]!;
    for (let i = 0; i < COUNTER_BYTES; i++) {
      this.nonce[i] = (this.nonce[i]! + 1) & 255;
      if (this.nonce[i] !== 0) return;
    }
    throw new Error('secretstream counter exhausted'); // 2^32 chunks: not reachable under the 4 GiB limit
  }
}

const zeros = (n: number) => new Uint8Array(n);

function polyKey(s: State): Uint8Array {
  return chacha20(s.k, s.nonce, zeros(64), undefined, 0).subarray(0, 32);
}

function macOver(polykey: Uint8Array, tagBlock: Uint8Array, c: Uint8Array): Uint8Array {
  // ad is empty: its padding is empty too. Then the 64-byte tag block, the ciphertext, padding, and both lengths. libsodium pads
  // with (16 - 64 + mlen) & 15 zero bytes, which is not the usual AEAD padding; it is reproduced exactly so the formats match.
  const pad = new Uint8Array((16 - 64 + c.length) & 15);
  return poly1305(concat([tagBlock, c, pad, le64(0), le64(64 + c.length)]), polykey);
}

export function secretStreamPush(key: Uint8Array, randomBytes: (n: number) => Uint8Array): SecretStreamPush {
  if (key.length !== KEY_BYTES) throw new Error('secretstream key must be 32 bytes');
  const header = randomBytes(SECRETSTREAM_HEADER_BYTES);
  const state = new State(hchacha20(key, header.subarray(0, 16)), header.subarray(16, 24));
  return {
    header,
    push(message, final) {
      const pk = polyKey(state);
      const block = zeros(64);
      block[0] = final ? TAG_FINAL : TAG_MESSAGE;
      const tagBlock = chacha20(state.k, state.nonce, block, undefined, 1);
      const c = chacha20(state.k, state.nonce, message, undefined, 2);
      const mac = macOver(pk, tagBlock, c);
      const out = new Uint8Array(1 + c.length + 16);
      out[0] = tagBlock[0]!;
      out.set(c, 1);
      out.set(mac, 1 + c.length);
      state.advance(mac);
      return out;
    },
  };
}

export function secretStreamPull(key: Uint8Array, header: Uint8Array): SecretStreamPull {
  if (key.length !== KEY_BYTES || header.length !== SECRETSTREAM_HEADER_BYTES) throw new Error('bad secretstream key or header');
  const state = new State(hchacha20(key, header.subarray(0, 16)), header.subarray(16, 24));
  return {
    pull(cipher) {
      if (cipher.length < SECRETSTREAM_ABYTES) return null;
      const c = cipher.subarray(1, cipher.length - 16);
      const given = cipher.subarray(cipher.length - 16);
      const pk = polyKey(state);
      const block = zeros(64);
      block[0] = cipher[0]!;
      const dec = chacha20(state.k, state.nonce, block, undefined, 1);
      const tag = dec[0]!;
      const tagBlock = new Uint8Array(dec);
      tagBlock[0] = cipher[0]!; // the MAC covers the tag block with the encrypted tag byte
      const mac = macOver(pk, tagBlock, c);
      let diff = 0;
      for (let i = 0; i < 16; i++) diff |= mac[i]! ^ given[i]!;
      if (diff !== 0) return null;
      const message = chacha20(state.k, state.nonce, c, undefined, 2);
      state.advance(mac);
      return { message, final: tag === TAG_FINAL };
    },
  };
}

function sha256Stream(): Sha256Stream {
  const h = sha256.create();
  return {
    update: (chunk) => void h.update(chunk),
    final: () => h.digest(),
  };
}

/**
 * The Crypto port with the secretstream and SHA-256 in pure TypeScript. Only the two things that need a native or WebAssembly
 * library are injected: random bytes and Argon2id. The app passes the libsodium binding for both.
 */
export function createPureCrypto(deps: { randomBytes: (n: number) => Uint8Array; argon2id: Crypto['argon2id'] }): Crypto {
  return {
    randomBytes: deps.randomBytes,
    sha256: (d) => sha256(d),
    sha256Stream,
    argon2id: deps.argon2id,
    secretStreamPush: (key) => secretStreamPush(key, deps.randomBytes),
    secretStreamPull,
  };
}
