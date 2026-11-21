import { NativeModules } from 'react-native';
import type { BackupDocument, ByteSource } from '@wmbugo/core';
import { fromBase64, toBase64 } from './base64';

interface Native {
  createDocument(suggestedName: string): Promise<string | null>;
  createTextDocument(suggestedName: string): Promise<string | null>;
  pickDocument(): Promise<string | null>;
  openWrite(uri: string): Promise<number>;
  write(handle: number, base64: string): Promise<void>;
  closeWrite(handle: number): Promise<void>;
  deleteDocument(uri: string): Promise<boolean>;
  openRead(uri: string): Promise<{ handle: number; size: number }>;
  readAt(handle: number, offset: number, length: number): Promise<string>;
  closeRead(handle: number): Promise<void>;
  openDecrypted(srcPath: string, keyHex: string): Promise<number>;
  readDecrypted(handle: number, length: number): Promise<string>;
  closeDecrypted(handle: number): Promise<void>;
  openEncryptedWrite(destPath: string, keyHex: string): Promise<number>;
  writeEncrypted(handle: number, base64: string): Promise<void>;
  closeEncrypted(handle: number): Promise<void>;
  restartApp(): Promise<void>;
}

const native = (): Native => {
  const m = NativeModules.WmbugoBackupFiles as Native | undefined;
  if (!m) throw new Error('Backup files are not available');
  return m;
};

async function openDocument(uri: string): Promise<BackupDocument> {
  const handle = await native().openWrite(uri);
  let open = true;
  const close = async () => {
    if (open) {
      open = false;
      await native().closeWrite(handle);
    }
  };
  return {
    sink: { write: (chunk) => native().write(handle, toBase64(chunk)) },
    async commit() {
      await close();
    },
    async abort() {
      // Cancelled, a full destination or a provider error: the partial document is removed.
      await close().catch(() => undefined);
      await native().deleteDocument(uri).catch(() => false);
    },
  };
}

/** The Android save dialog (Storage Access Framework, no permission). null when it is cancelled; nothing is written then. */
export async function createBackupDocument(suggestedName: string): Promise<BackupDocument | null> {
  const uri = await native().createDocument(suggestedName);
  return uri === null ? null : openDocument(uri);
}

/** The save dialog for a plain text file (the diagnostics export, Story 8.10). */
export async function createTextDocument(suggestedName: string): Promise<BackupDocument | null> {
  const uri = await native().createTextDocument(suggestedName);
  return uri === null ? null : openDocument(uri);
}

/** The system file picker for a backup to restore (Story 8.9). null when cancelled. */
export async function pickBackupFile(): Promise<{ source: ByteSource; close(): Promise<void> } | null> {
  const uri = await native().pickDocument();
  if (uri === null) return null;
  const { handle, size } = await native().openRead(uri);
  return {
    source: {
      size,
      async read(offset, length) {
        return fromBase64(await native().readAt(handle, offset, length));
      },
    },
    close: () => native().closeRead(handle),
  };
}

/** A receipt photo, decrypted with the device file key and streamed in memory in order; nothing plain is written to disk. */
export async function* streamDecrypted(path: string, keyHex: string, chunk = 64 * 1024): AsyncGenerator<Uint8Array> {
  const handle = await native().openDecrypted(path, keyHex);
  try {
    for (;;) {
      const bytes = fromBase64(await native().readDecrypted(handle, chunk));
      if (bytes.length === 0) return;
      yield bytes;
    }
  } finally {
    await native().closeDecrypted(handle).catch(() => undefined);
  }
}

/** Writes a receipt photo into app-private storage encrypted with the device file key as its bytes arrive (restore, Story 8.8). */
export async function openEncryptedPhoto(destPath: string, keyHex: string): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void> }> {
  const handle = await native().openEncryptedWrite(destPath, keyHex);
  return {
    write: (chunk) => native().writeEncrypted(handle, toBase64(chunk)),
    close: () => native().closeEncrypted(handle),
  };
}

/** Restarts the app after a restore swapped the data. Does not return. */
export function restartApp(): Promise<void> {
  return native().restartApp();
}
