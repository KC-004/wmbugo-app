import { DeleteImportFile, DiscardImport, listImports, SetImportRetention, type ImportListItem, type ImportRetention } from '@wmbugo/core';
import { rnRawFileStore } from '../../adapters/import/rnRawFileStore';
import { readProfile } from '../../adapters/readProfile';
import { getServices } from '../../adapters/startApp';

export interface ImportedFilesData {
  readonly retention: ImportRetention;
  readonly locale: string;
  readonly items: readonly ImportListItem[];
}

/** The doors for Settings › Data › Imported files. Deleting a file is two steps: the commit clears the row, then the file goes. */
export interface ImportedFilesApi {
  load(): Promise<ImportedFilesData | null>;
  setRetention(choice: ImportRetention): Promise<boolean>;
  deleteFile(batchId: string): Promise<boolean>;
  discard(batchId: string): Promise<boolean>;
}

const removeAll = async (paths: readonly string[]) => {
  for (const p of paths) await rnRawFileStore.remove(p).catch(() => undefined);
};

export const realImportedFilesApi: ImportedFilesApi = {
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    return { retention: p.settings.importRetention, locale: p.locale, items: await listImports(db) };
  },
  async setRetention(choice) {
    const r = await getServices().writer.run(SetImportRetention, { choice }, 'user');
    if (!r.ok) return false;
    await removeAll(r.value.paths);
    return true;
  },
  async deleteFile(batchId) {
    const r = await getServices().writer.run(DeleteImportFile, { batchId }, 'user');
    if (!r.ok) return false;
    await removeAll([r.value.path]);
    return true;
  },
  async discard(batchId) {
    const r = await getServices().writer.run(DiscardImport, { batchId }, 'user');
    if (!r.ok) return false;
    await removeAll(r.value.path ? [r.value.path] : []);
    return true;
  },
};
