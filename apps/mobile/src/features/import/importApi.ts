import { ACCOUNT_LIST_SQL, findSavedFormat, mapAccountRows, MAX_CSV_BYTES, SaveCsvFormat, type CsvReadResult, type SaveCsvFormatInput, type SavedCsvFormat } from '@wmbugo/core';
import { pickCsvFile } from '../../adapters/backup/backupFiles';
import { readProfile } from '../../adapters/readProfile';
import { getServices } from '../../adapters/startApp';

/** What the wizard needs to know about this phone before it can place rows. */
export interface ImportContext {
  readonly currency: string;
  readonly exponent: number;
  readonly locale: string;
  readonly timezoneId: string;
  readonly accounts: readonly { id: string; name: string }[];
}

export interface PickedCsv {
  readonly bytes: Uint8Array;
  /** The file's size; over the limit `bytes` is empty and the wizard says the file is too large. */
  readonly size: number;
}

/** The wizard's only doors to the phone: the picker, the profile and accounts, and the saved layouts. */
export interface ImportApi {
  /** null when the picker is cancelled. */
  pick(): Promise<PickedCsv | null>;
  context(): Promise<ImportContext | null>;
  savedFormat(read: Pick<CsvReadResult, 'header' | 'delimiter'>): Promise<SavedCsvFormat | null>;
  saveFormat(input: SaveCsvFormatInput): Promise<{ ok: boolean }>;
}

export const realImportApi: ImportApi = {
  pick: () => pickCsvFile(MAX_CSV_BYTES),
  async context() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const accounts = mapAccountRows(await db.query(ACCOUNT_LIST_SQL))
      .filter((a) => a.status === 'active')
      .map((a) => ({ id: a.id, name: a.name }));
    return { currency: p.currency, exponent: p.exponent, locale: p.locale, timezoneId: p.timezoneId, accounts };
  },
  savedFormat: (read) => findSavedFormat(getServices().db, read),
  saveFormat: (input) => getServices().writer.run(SaveCsvFormat, input, 'user'),
};
