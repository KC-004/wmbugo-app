import * as Keychain from 'react-native-keychain';
import type { KeyStore } from '@wmbugo/core';

const SERVICE = 'app.wmbugo.database-key';
const ACCOUNT = 'database';

/**
 * Database key in Android Keystore via react-native-keychain. Hardware-backed
 * AES-GCM wrapping, no authentication required: the key is usable after the
 * first unlock since boot and is not bound to biometrics or a PIN. Never
 * logged, never written to a file; allowBackup=false keeps it out of backups.
 */
/** Deletes the database key from the Keystore (erase all data, Story 8.11). Resolves when it is gone or was never there. */
export async function deleteDatabaseKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}

export const keychainKeyStore: KeyStore = {
  async getKey() {
    const found = await Keychain.getGenericPassword({ service: SERVICE });
    return found ? found.password : null;
  },
  async setKey(keyHex) {
    const saved = await Keychain.setGenericPassword(ACCOUNT, keyHex, {
      service: SERVICE,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
    });
    return saved !== false;
  },
};
