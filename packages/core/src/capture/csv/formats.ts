import { err, ok } from '../../shared/result';
import { sha256Hex } from '../../shared/sha256';
import type { Querier } from '../../planning/budgets';
import type { UseCase } from '../../writer/ledgerWriter';
import { normalizeHeading, type CsvMapping } from './mapping';
import type { CsvAccountChoice } from './rows';
import type { CsvReadResult } from './read';

/**
 * Saved bank formats (Story 9.2, IMP-002): the mapping and the choices made with it, remembered under a signature of the file's
 * heading row so the next file from the same bank skips the Columns step. A format holds no row data: no description, amount or date
 * from any file, only the layout.
 */

/** SHA-256 of the normalized heading cells and the delimiter. Any heading that differs, in any cell, gives another signature. */
export function headerSignature(header: readonly string[], delimiter: string): string {
  return sha256Hex(`${header.map(normalizeHeading).join('\u001f')}\u001e${delimiter}`);
}

/** What the reader's overrides were, so the same file reads the same way next time. */
export interface CsvOverrides {
  readonly encoding?: string;
  readonly delimiter?: string;
  readonly headerRow?: number;
  readonly noHeader?: boolean;
}

export interface SavedCsvFormat {
  readonly id: string;
  readonly name: string;
  readonly headerSignature: string;
  readonly mapping: CsvMapping;
  readonly overrides: CsvOverrides;
  readonly account: CsvAccountChoice | null;
}

export type SaveCsvFormatError = 'FORMAT_INVALID';

export interface SaveCsvFormatInput {
  readonly name: string;
  readonly headerSignature: string;
  readonly mapping: CsvMapping;
  readonly overrides: CsvOverrides;
  readonly account: CsvAccountChoice | null;
}

/**
 * Saves a bank format, or updates the one with the same signature. One audited write. The name defaults to the account name
 * (`Monzo Current`) in the caller; the audit row records that a format changed, never its content.
 */
export const SaveCsvFormat: UseCase<SaveCsvFormatInput, { id: string }, SaveCsvFormatError> = {
  name: 'SaveCsvFormat',
  async execute(ctx, input) {
    const name = input.name.trim();
    if (name === '' || name.length > 80 || !/^[0-9a-f]{64}$/.test(input.headerSignature)) return err('FORMAT_INVALID');
    const existing = await ctx.query('SELECT id FROM csv_format WHERE header_signature = ?', [input.headerSignature]);
    const mappingJson = JSON.stringify(input.mapping);
    const overridesJson = JSON.stringify(input.overrides);
    const accountJson = JSON.stringify(input.account ?? {});
    const now = ctx.nowMs();
    let id: string;
    if (existing.length > 0) {
      id = String(existing[0]![0]);
      await ctx.execute('UPDATE csv_format SET name = ?, mapping_json = ?, overrides_json = ?, flip_sign = ?, account_json = ?, updated_at = ? WHERE id = ?', [
        name,
        mappingJson,
        overridesJson,
        input.mapping.flipSign ? 1 : 0,
        accountJson,
        now,
        id,
      ]);
    } else {
      id = ctx.newId();
      await ctx.execute(
        'INSERT INTO csv_format (id, name, header_signature, mapping_json, overrides_json, flip_sign, account_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, name, input.headerSignature, mappingJson, overridesJson, input.mapping.flipSign ? 1 : 0, accountJson, now, now],
      );
    }
    ctx.touch('csv_format', id, { changed: true });
    ctx.emit('CsvFormatsChanged', { formatIds: [id] });
    return ok({ id });
  },
};

function parseFormat(row: readonly unknown[]): SavedCsvFormat | null {
  try {
    const account = JSON.parse(String(row[5])) as CsvAccountChoice | Record<string, never>;
    return {
      id: String(row[0]),
      name: String(row[1]),
      headerSignature: String(row[2]),
      mapping: JSON.parse(String(row[3])) as CsvMapping,
      overrides: JSON.parse(String(row[4])) as CsvOverrides,
      account: 'kind' in account ? (account as CsvAccountChoice) : null,
    };
  } catch {
    return null; // a damaged row is not a match: the Columns step runs instead
  }
}

const FORMAT_SQL = 'SELECT id, name, header_signature, mapping_json, overrides_json, account_json FROM csv_format';

/** The saved format for a file whose heading row matches, or nothing when any heading cell differs. */
export async function findSavedFormat(db: Querier, read: Pick<CsvReadResult, 'header' | 'delimiter'>): Promise<SavedCsvFormat | null> {
  if (read.header.length === 0) return null; // a file with no heading row has no signature
  const rows = await db.query(`${FORMAT_SQL} WHERE header_signature = ?`, [headerSignature(read.header, read.delimiter.value)]);
  return rows.length === 0 ? null : parseFormat(rows[0]!);
}

/** Every saved format, newest first (Settings can list them later). */
export async function listSavedFormats(db: Querier): Promise<SavedCsvFormat[]> {
  const rows = await db.query(`${FORMAT_SQL} ORDER BY updated_at DESC`);
  return rows.map(parseFormat).filter((f): f is SavedCsvFormat => f !== null);
}

