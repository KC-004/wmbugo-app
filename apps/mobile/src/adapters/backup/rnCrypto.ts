import sodium from 'react-native-libsodium';
import { createPureCrypto, type Crypto } from '@wmbugo/core';

/**
 * The Crypto port on the phone (Story 8.6). Argon2id and random bytes come from the libsodium binding (native, fast); the
 * XChaCha20-Poly1305 secretstream and SHA-256 are the pure TypeScript implementations in core, because the binding does not
 * expose the secretstream and Hermes cannot run libsodium's WebAssembly. Core's tests prove them byte-compatible with libsodium.
 */
export function createRnCrypto(): Crypto {
  return createPureCrypto({
    randomBytes: (n) => new Uint8Array(sodium.randombytes_buf(n)),
    async argon2id(passphrase, salt, opslimit, memlimitBytes, outLength) {
      return new Uint8Array(sodium.crypto_pwhash(outLength, passphrase, salt, opslimit, memlimitBytes, sodium.crypto_pwhash_ALG_ARGON2ID13));
    },
  });
}
