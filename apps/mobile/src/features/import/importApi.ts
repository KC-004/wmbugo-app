import {
  ACCOUNT_LIST_SQL,
  findSavedFormat,
  mapAccountRows,
  MAX_CSV_BYTES,
  planImportFile,
  readImport,
  resumeCsvImport,
  runCsvImport,
  SaveCsvFormat,
  type CsvOverrides,
  type CsvReadOptions,
  type CsvReadResult,
  type ImportPlan,
  type ImportSummary,
  type Result,
  type RowDecision,
  type RunImportError,
  type SaveCsvFormatInput,
  type SavedCsvFormat,
} from '@wmbugo/core';
import { createRnCrypto } from '../../adapters/backup/rnCrypto';
import { createTextDocument, pickCsvFile } from '../../adapters/backup/backupFiles';
import { rnRawFileStore } from '../../adapters/import/rnRawFileStore';
import { readProfile } from '../../adapters/readProfile';
import { getServices } from '../../adapters/startApp';
import type { ImportDraft } from './importModel';

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
export interface WizardApi {
  /** null when the picker is cancelled. */
  pick(): Promise<PickedCsv | null>;
  context(): Promise<ImportContext | null>;
  savedFormat(read: Pick<CsvReadResult, 'header' | 'delimiter'>): Promise<SavedCsvFormat | null>;
  saveFormat(input: SaveCsvFormatInput): Promise<{ ok: boolean }>;
}

/** What a running import tells the screen and asks of it. */
export interface RunHooks {
  onProgress(done: number, total: number): void;
  isCancelled(): boolean;
}

/** The doors for checking matches, running, resuming and saving the rows that could not be read. */
export interface RunApi {
  plan(draft: ImportDraft): Promise<ImportPlan | null>;
  run(draft: ImportDraft, decisions: Readonly<Record<number, RowDecision>>, hooks: RunHooks): Promise<Result<ImportSummary, RunImportError>>;
  /** The import the app was closed in the middle of, if any. */
  paused(): Promise<ImportSummary | null>;
  resume(batchId: string, hooks: RunHooks): Promise<Result<ImportSummary, RunImportError>>;
  /** Saves text as a file the person picks the place for (UTF-8 with a byte order mark so a spreadsheet opens it right). False when cancelled or failed. */
  saveRows(csv: string): Promise<boolean>;
}

export type ImportApi = WizardApi & RunApi;

const toReadOptions = (o: CsvOverrides): CsvReadOptions => o as CsvReadOptions;

async function deps(hooks?: RunHooks) {
  const s = getServices();
  const p = await readProfile(s.db);
  if (!p) throw new Error('no profile');
  return {
    writer: s.writer,
    db: s.db,
    files: rnRawFileStore,
    crypto: createRnCrypto(),
    nowMs: () => Date.now(),
    profile: { currency: p.currency, timezoneId: p.timezoneId },
    ...(hooks ? { isCancelled: hooks.isCancelled, onProgress: hooks.onProgress } : {}),
  };
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
  async plan(draft) {
    return planImportFile(await deps(), { bytes: draft.bytes, overrides: toReadOptions(draft.overrides), mapping: draft.mapping, account: draft.choice });
  },
  async run(draft, decisions, hooks) {
    return runCsvImport(await deps(hooks), { bytes: draft.bytes, overrides: toReadOptions(draft.overrides), mapping: draft.mapping, account: draft.choice, decisions });
  },
  async paused() {
    const rows = await getServices().db.query("SELECT id FROM import_batch WHERE status = 'paused' ORDER BY created_at DESC LIMIT 1");
    if (rows.length === 0) return null;
    return readImport(getServices().db, String(rows[0]![0]));
  },
  async resume(batchId, hooks) {
    return resumeCsvImport(await deps(hooks), batchId);
  },
  async saveRows(csv) {
    const doc = await createTextDocument('wmbugo-rows-not-imported.csv');
    if (doc === null) return false;
    try {
      const body = new TextEncoder().encode(csv);
      const out = new Uint8Array(3 + body.length);
      out.set([0xef, 0xbb, 0xbf], 0);
      out.set(body, 3);
      await doc.sink.write(out);
      await doc.commit();
      return true;
    } catch {
      await doc.abort().catch(() => undefined);
      return false;
    }
  },
};
