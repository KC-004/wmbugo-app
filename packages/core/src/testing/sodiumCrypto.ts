import sodium from 'libsodium-wrappers-sumo';
import type { Crypto } from '../ports/crypto';

/**
 * The Crypto port on `libsodium-wrappers-sumo` (Node tests). The mobile app uses a libsodium binding behind the same port. Call
 * `await createSodiumCrypto()` once: libsodium loads its WebAssembly asynchronously.
 */
export async function createSodiumCrypto(): Promise<Crypto> {
  await sodium.ready;
  const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
  const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
  return {
    randomBytes: (n) => sodium.randombytes_buf(n),
    sha256: (d) => sodium.crypto_hash_sha256(d),
    sha256Stream() {
      const state = sodium.crypto_hash_sha256_init();
      return {
        update: (chunk) => void sodium.crypto_hash_sha256_update(state, chunk),
        final: () => sodium.crypto_hash_sha256_final(state),
      };
    },
    async argon2id(passphrase, salt, opslimit, memlimit, outLength) {
      return sodium.crypto_pwhash(outLength, passphrase, salt, opslimit, memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
    },
    secretStreamPush(key) {
      const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
      return {
        header,
        push: (message, final) => sodium.crypto_secretstream_xchacha20poly1305_push(state, message, null, final ? TAG_FINAL : TAG_MESSAGE),
      };
    },
    secretStreamPull(key, header) {
      const state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
      return {
        pull(cipher) {
          try {
            const r = sodium.crypto_secretstream_xchacha20poly1305_pull(state, cipher, null);
            if (!r) return null;
            return { message: r.message, final: r.tag === TAG_FINAL };
          } catch {
            return null;
          }
        },
      };
    },
  };
}
