/**
 * KeyStore port: holds the 256-bit database key (hex) in the platform keystore.
 * The key is available after first unlock since boot and is not bound to
 * biometrics or a PIN. It is never logged, written to a file or exported.
 */
export interface KeyStore {
  /** Returns the stored key, or null when none exists yet. Rejects only on keystore failure. */
  getKey(): Promise<string | null>;
  /** Stores the key. Returns false when the keystore refused it. */
  setKey(keyHex: string): Promise<boolean>;
}
