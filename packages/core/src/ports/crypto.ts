/**
 * Crypto port (Story 8.6, AD-9, AD-10): the primitives a backup needs. The mobile adapter is a libsodium binding and the
 * Node tests use `libsodium-wrappers-sumo`; core never imports either. All lengths are in bytes.
 */
export interface SecretStreamPush {
  /** The 24-byte stream header, written in the clear before the first chunk. */
  readonly header: Uint8Array;
  /** Encrypts one chunk; the last chunk of a stream is tagged FINAL. */
  push(message: Uint8Array, final: boolean): Uint8Array;
}

export interface SecretStreamPull {
  /** Decrypts one chunk; null when it fails authentication. `final` is true when the chunk carries the FINAL tag. */
  pull(cipher: Uint8Array): { readonly message: Uint8Array; readonly final: boolean } | null;
}

export interface Sha256Stream {
  update(chunk: Uint8Array): void;
  final(): Uint8Array;
}

export interface Crypto {
  randomBytes(length: number): Uint8Array;
  sha256(data: Uint8Array): Uint8Array;
  sha256Stream(): Sha256Stream;
  /** Argon2id key derivation: `outLength` bytes from the passphrase bytes and a 16-byte salt. */
  argon2id(passphrase: Uint8Array, salt: Uint8Array, opslimit: number, memlimitBytes: number, outLength: number): Promise<Uint8Array>;
  /** XChaCha20-Poly1305 secretstream with a 32-byte key. */
  secretStreamPush(key: Uint8Array): SecretStreamPush;
  secretStreamPull(key: Uint8Array, header: Uint8Array): SecretStreamPull;
}

/** Bytes a secretstream adds to every chunk (the authentication tag and the tag byte). */
export const SECRETSTREAM_ABYTES = 17;
/** Length of the secretstream header. */
export const SECRETSTREAM_HEADER_BYTES = 24;
