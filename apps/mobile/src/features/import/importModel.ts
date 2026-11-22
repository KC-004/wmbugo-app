import {
  guessMapping,
  mappingProblems,
  readCsv,
  validateCsvRows,
  type CsvAccountChoice,
  type CsvDelimiter,
  type CsvEncoding,
  type CsvMapping,
  type CsvOverrides,
  type CsvProfile,
  type CsvReadError,
  type CsvReadResult,
  type CsvRole,
  type CsvValidation,
  type Result,
  type SavedCsvFormat,
} from '@wmbugo/core';
import { copy } from '../../shared/copy';

/** What the person chose to change about how the file is read (the File settings sheet). */
export type ReadOverrides = CsvOverrides;

/** Reads the file with the person's overrides (Story 9.1 detects the rest). */
export function readWith(bytes: Uint8Array, overrides: ReadOverrides): Result<CsvReadResult, CsvReadError> {
  return readCsv(bytes, {
    ...(overrides.encoding ? { encoding: overrides.encoding as CsvEncoding } : {}),
    ...(overrides.delimiter ? { delimiter: overrides.delimiter as CsvDelimiter } : {}),
    ...(overrides.headerRow !== undefined ? { headerRow: overrides.headerRow } : {}),
    ...(overrides.noHeader ? { noHeader: true } : {}),
  });
}

export const READ_ERROR_COPY: Readonly<Record<CsvReadError, string>> = {
  EMPTY_FILE: copy.csvImport.emptyFile,
  NO_ROWS: copy.csvImport.noRows,
  NOT_A_CSV: copy.csvImport.notCsv,
  FILE_TOO_LARGE: copy.csvImport.tooLarge,
};

/** The columns of the file, named by their heading or else by position. */
export function columnNames(read: CsvReadResult): string[] {
  const width = Math.max(read.header.length, ...read.sample.map((r) => r.length), 0);
  return Array.from({ length: width }, (_, i) => {
    const h = (read.header[i] ?? '').trim();
    return h === '' ? copy.csvImport.columnWord.replace('{n}', String(i + 1)) : h;
  });
}

/** A first value from the sample, so the person can tell two similar columns apart. */
export function sampleOf(read: CsvReadResult, column: number): string {
  for (const row of read.sample) {
    const v = (row[column] ?? '').trim();
    if (v !== '') return v.length > 24 ? `${v.slice(0, 24)}…` : v;
  }
  return '';
}

export const guess = (read: CsvReadResult): CsvMapping => guessMapping(read.header, read.sample);

/** The overrides to save with a layout: only what the person or the file actually pinned. */
export function overridesOf(read: CsvReadResult): ReadOverrides {
  return {
    encoding: read.encoding.value,
    delimiter: read.delimiter.value,
    ...(read.headerRow.value === null ? { noHeader: true } : { headerRow: read.headerRow.value }),
  };
}

/** Whether a saved format needs the file read differently from the default reading. */
export function needsReread(read: CsvReadResult, saved: SavedCsvFormat): boolean {
  const o = saved.overrides;
  return (
    (o.encoding !== undefined && o.encoding !== read.encoding.value) ||
    (o.delimiter !== undefined && o.delimiter !== read.delimiter.value) ||
    (o.noHeader === true && read.headerRow.value !== null) ||
    (o.headerRow !== undefined && o.headerRow !== read.headerRow.value)
  );
}

/** The account choice the mapping asks for: one account for the file, or the file's own account column mapped value by value. */
export function choiceFits(mapping: CsvMapping, choice: CsvAccountChoice | null): CsvAccountChoice | null {
  if (choice === null) return null;
  return mapping.columns.account !== undefined ? (choice.kind === 'column' ? choice : null) : choice.kind === 'single' ? choice : null;
}

/** True once every row can be placed in an account. */
export function accountReady(mapping: CsvMapping, choice: CsvAccountChoice | null, accountValues: readonly string[]): boolean {
  const c = choiceFits(mapping, choice);
  if (c === null) return false;
  if (c.kind === 'single') return c.accountId !== '';
  return accountValues.every((v) => Object.prototype.hasOwnProperty.call(c.map, v));
}

export type ColumnsBlock = { kind: 'role'; role: CsvRole } | { kind: 'amount' } | { kind: 'dateOrder' } | { kind: 'account' } | { kind: 'map' };

/** The first thing still missing before Next is allowed, as the sentence that says what to do; null when nothing is. */
export function columnsBlock(mapping: CsvMapping, choice: CsvAccountChoice | null, accountValues: readonly string[]): { block: ColumnsBlock; message: string } | null {
  const problems = mappingProblems(mapping);
  if (problems.includes('date')) return { block: { kind: 'role', role: 'date' }, message: copy.csvImport.roleNeeded.replace('{role}', copy.csvImport.roleDate.toLowerCase()) };
  if (problems.includes('description')) return { block: { kind: 'role', role: 'description' }, message: copy.csvImport.roleNeeded.replace('{role}', copy.csvImport.roleDescription.toLowerCase()) };
  if (problems.includes('amount')) return { block: { kind: 'amount' }, message: copy.csvImport.amountNeeded };
  if (problems.includes('dateFormat')) return { block: { kind: 'dateOrder' }, message: copy.csvImport.dateOrderNeeded };
  if (!accountReady(mapping, choice, accountValues)) {
    return mapping.columns.account !== undefined
      ? { block: { kind: 'map' }, message: copy.csvImport.mapNeeded }
      : { block: { kind: 'account' }, message: copy.csvImport.accountNeeded };
  }
  return null;
}

export interface Checked {
  readonly validation: CsvValidation;
  readonly block: ReturnType<typeof columnsBlock>;
}

/** Validates every row for the current choices (the preview and the Next check use the same result). */
export function check(read: CsvReadResult, mapping: CsvMapping, profile: CsvProfile, choice: CsvAccountChoice | null): Checked {
  const base = validateCsvRows(read.rows, mapping, profile, choiceFits(mapping, choice) ?? undefined);
  return { validation: base, block: columnsBlock(mapping, choice, base.accountValues) };
}

/** Everything the next screens (Story 9.7) need from the wizard. */
export interface ImportDraft {
  readonly bytes: Uint8Array;
  readonly read: CsvReadResult;
  readonly mapping: CsvMapping;
  readonly choice: CsvAccountChoice;
  readonly overrides: ReadOverrides;
  readonly validation: CsvValidation;
}
