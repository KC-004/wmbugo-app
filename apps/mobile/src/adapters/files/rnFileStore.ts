import * as RNFS from '@dr.pogodin/react-native-fs';
import type { FileStore } from '@wmbugo/core';

/** App-private files directory (internal storage, not visible to other apps, excluded from backup). */
export const PRIVATE_DIR = RNFS.DocumentDirectoryPath;

export const rnFileStore: FileStore = {
  exists: (path) => RNFS.exists(path),
  async size(path) {
    const s = await RNFS.stat(path);
    return Number(s.size);
  },
  append: (path, text) => RNFS.appendFile(path, text, 'utf8'),
  write: (path, text) => RNFS.writeFile(path, text, 'utf8'),
  move: (from, to) => RNFS.moveFile(from, to),
  remove: (path) => RNFS.unlink(path),
};

export function ensureDir(path: string): Promise<void> {
  return RNFS.mkdir(path);
}

export function copyFile(from: string, to: string): Promise<void> {
  return RNFS.copyFile(from, to);
}

export function fileExists(path: string): Promise<boolean> {
  return RNFS.exists(path);
}
