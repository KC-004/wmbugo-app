import { NativeModules } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { attachmentFileName, orphanFiles } from '@wmbugo/core';
import { PRIVATE_DIR } from './rnFileStore';
import { keychainKeyStore } from '../storage/keychainKeyStore';

/** Where encrypted receipt photos live: app-private, named `<attachment id>.enc`. */
export const RECEIPTS_DIR = `${PRIVATE_DIR}/receipts`;

interface Native {
  pickPhoto(): Promise<string | null>;
  importEncrypted(uri: string, destPath: string, keyHex: string): Promise<{ digest: string; size: number }>;
  decryptToCache(srcPath: string, keyHex: string, name: string): Promise<string>;
  clearViewCache(): Promise<void>;
}

const native = (): Native => {
  const m = NativeModules.WmbugoReceiptFiles as Native | undefined;
  if (!m) throw new Error('Receipt files are not available');
  return m;
};

async function key(): Promise<string> {
  const k = await keychainKeyStore.getKey();
  if (!k) throw new Error('No key');
  return k;
}

export const filePath = (attachmentId: string): string => `${RECEIPTS_DIR}/${attachmentFileName(attachmentId)}`;

/** The photo side of the FileStore: pick (no permission), encrypt into private storage, decrypt for viewing, delete, sweep. */
export interface ReceiptFiles {
  pick(): Promise<string | null>;
  /** Encrypts the picked image to its attachment file BEFORE the row commits. */
  importPhoto(uri: string, attachmentId: string): Promise<{ digest: string; size: number }>;
  /** A plain temporary file for showing the photo (deleted by `clearViewCache`). */
  viewPath(attachmentId: string): Promise<string>;
  remove(attachmentId: string): Promise<void>;
  clearViewCache(): Promise<void>;
  /** Deletes files no attachment row refers to (a kill between the file write and the row commit leaves one). */
  sweep(referencedIds: ReadonlySet<string>): Promise<number>;
}

export const realReceiptFiles: ReceiptFiles = {
  pick: () => native().pickPhoto(),
  async importPhoto(uri, attachmentId) {
    await RNFS.mkdir(RECEIPTS_DIR);
    return native().importEncrypted(uri, filePath(attachmentId), await key());
  },
  async viewPath(attachmentId) {
    return native().decryptToCache(filePath(attachmentId), await key(), attachmentId);
  },
  async remove(attachmentId) {
    const p = filePath(attachmentId);
    if (await RNFS.exists(p)) await RNFS.unlink(p);
  },
  clearViewCache: () => native().clearViewCache(),
  async sweep(referencedIds) {
    if (!(await RNFS.exists(RECEIPTS_DIR))) return 0;
    const names = (await RNFS.readDir(RECEIPTS_DIR)).map((f) => f.name);
    const orphans = orphanFiles(names, referencedIds);
    for (const name of orphans) await RNFS.unlink(`${RECEIPTS_DIR}/${name}`);
    return orphans.length;
  },
};
