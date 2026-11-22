import type { Crypto } from '../../ports/crypto';
import type { Querier } from '../../planning/budgets';
import { err, ok, type Result } from '../../shared/result';
import type { LedgerWriter, UseCase } from '../../writer/ledgerWriter';
import { toHex } from '../../backup/format';
import {
  actionFor,
  FinishCsvImport,
  IMPORT_BATCH_ROWS,
  ImportCsvBatch,
  StartCsvImport,
  type ImportBatchError,
  type ImportBatchInput,
  type ImportBatchResult,
  type ImportInputRow,
  type ImportStatus,
  type RowDecision,
} from './import';
import type { CsvMapping } from './mapping';
import { cleanFileName, DropImportRawCopy } from './importFiles';
import { planCsvImport, type ImportPlan, type PlannedRow } from './plan';
import { loadImportPlanContext } from './planContext';
import { readCsv, type CsvReadOptions } from './read';
import { validateCsvRows, type CsvAccountChoice, type CsvProfile } from './rows';

/**
 * Running an import (Story 9.4): read, validate, plan, keep an encrypted copy of the file, then commit it in batches of at most 500
 * rows, each its own transaction. Pausing and resuming are the same loop: a resume reads the retained copy again, re-plans (rows
 * already committed are recognised by their fingerprints) and carries on from the row after \`committed_through_row\`.
 */

/** The encrypted copy of the raw file (AD-9). The phone implements it with the device file key; tests use memory. */
export interface RawFileStore {
  /** Writes the bytes encrypted in app-private storage and returns where. */
  save(name: string, bytes: Uint8Array): Promise<string>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}

export interface RunImportDeps {
  readonly writer: Pick<LedgerWriter, 'run'>;
  readonly db: Querier;
  readonly files: RawFileStore;
  readonly crypto: Pick<Crypto, 'sha256'>;
  readonly nowMs: () => number;
  readonly profile: CsvProfile;
  /** Polled between batches: true stops after the batch in hand, leaving the import paused. */
  readonly isCancelled?: () => boolean;
  /** Rows committed so far and rows in all. */
  readonly onProgress?: (done: number, total: number) => void;
  /** How long the raw copy is kept, in days (30 by default); 0 deletes it right after the import completes; null keeps it until the person deletes it. */
  readonly retainDays?: number | null;
  /** Rows per batch, at most 500 (a smaller number lets a test cut an import short at many points). */
  readonly batchRows?: number;
  /** Tests substitute the batch use case to kill the process in the middle of a batch. */
  readonly batchUseCase?: UseCase<ImportBatchInput, ImportBatchResult, ImportBatchError>;
}

export interface ImportJob {
  readonly bytes: Uint8Array;
  /** The reader overrides in force (encoding, delimiter, heading row), so a resume reads the file the same way. */
  readonly overrides: CsvReadOptions;
  readonly mapping: CsvMapping;
  readonly account: CsvAccountChoice;
  readonly formatId?: string | null;
  /** The person's per-row choices, by file row. Rows not listed take their class's default. */
  readonly decisions: Readonly<Record<number, RowDecision>>;
  /** The file's display name from the picker (Story 9.8). */
  readonly fileName?: string | null;
}

export interface ImportSummary {
  readonly batchId: string;
  readonly status: ImportStatus;
  readonly rowCount: number;
  readonly committedThroughRow: number;
  readonly imported: number;
  readonly skipped: number;
  readonly review: number;
  readonly errors: number;
}

export type RunImportError = 'FILE_NOT_READABLE' | 'IMPORT_FAILED' | 'IMPORT_NOT_FOUND' | 'FILE_CHANGED' | 'RAW_COPY_MISSING' | 'IMPORT_NOT_RESUMABLE';

const DAY_MS = 86_400_000;
const BATCH_COLUMNS = 'id, status, row_count, committed_through_row, imported_count, skipped_count, review_count, error_count';

function toSummary(r: readonly unknown[]): ImportSummary {
  return {
    batchId: String(r[0]),
    status: String(r[1]) as ImportStatus,
    rowCount: Number(r[2]),
    committedThroughRow: Number(r[3]),
    imported: Number(r[4]),
    skipped: Number(r[5]),
    review: Number(r[6]),
    errors: Number(r[7]),
  };
}

/** The import's counts and position, as the wizard's summary and Settings show them. */
export async function readImport(db: Querier, batchId: string): Promise<ImportSummary | null> {
  const r = (await db.query(`SELECT ${BATCH_COLUMNS} FROM import_batch WHERE id = ?`, [batchId]))[0];
  return r ? toSummary(r) : null;
}

/** Turns the plan into what the batch use case takes, with each row's decision and, for a transfer pair, the other leg's fingerprint. */
function inputRows(planned: readonly PlannedRow[], decisions: Readonly<Record<number, RowDecision>>): ImportInputRow[] {
  const fingerprintOf = new Map(planned.map((p) => [p.row, p.fingerprint]));
  return planned.map((p) => ({
    row: p.row,
    class: p.class,
    ...(decisions[p.row] ? { decision: decisions[p.row]! } : {}),
    candidate: p.candidate,
    fingerprint: p.fingerprint,
    ...(p.matchId ? { matchId: p.matchId } : {}),
    // The earlier leg is committed first; the later one points back at it.
    ...(p.pairRow !== undefined && p.pairRow < p.row && fingerprintOf.get(p.pairRow) ? { pairFingerprint: fingerprintOf.get(p.pairRow)! } : {}),
    ...(p.errors.length > 0 ? { errorCodes: p.errors.map((e) => e.code) } : {}),
  }));
}

async function commitBatches(deps: RunImportDeps, batchId: string, rows: readonly ImportInputRow[], from: number, total: number): Promise<Result<ImportSummary, RunImportError>> {
  const useCase = deps.batchUseCase ?? ImportCsvBatch;
  const size = Math.max(1, Math.min(IMPORT_BATCH_ROWS, deps.batchRows ?? IMPORT_BATCH_ROWS));
  const todo = rows.filter((r) => r.row > from).sort((a, b) => a.row - b.row);
  let done = rows.length - todo.length;
  for (let i = 0; i < todo.length; i += size) {
    // Cancel is honoured between batches: the batch in hand finishes, committed batches stay, and the import is paused.
    if (deps.isCancelled?.()) {
      await deps.writer.run(FinishCsvImport, { batchId, status: 'paused' }, 'user');
      return readSummary(deps, batchId);
    }
    const part = todo.slice(i, i + size);
    const r = await deps.writer.run(useCase, { batchId, rows: part, throughRow: part[part.length - 1]!.row }, 'user');
    if (!r.ok) {
      // The batch did not commit and left nothing behind; the import stays resumable from the last committed row.
      await deps.writer.run(FinishCsvImport, { batchId, status: 'paused' }, 'user');
      return err('IMPORT_FAILED');
    }
    done += part.length;
    deps.onProgress?.(done, total);
  }
  const fin = await deps.writer.run(FinishCsvImport, { batchId, status: 'completed' }, 'user');
  if (!fin.ok) return err('IMPORT_FAILED');
  // `Deleted after import`: the copy goes after the completing commit. A failure here leaves an expired copy that the daily purge removes.
  if (deps.retainDays === 0) {
    const dropped = await deps.writer.run(DropImportRawCopy, { batchId }, 'user');
    if (dropped.ok && dropped.value.path) await deps.files.remove(dropped.value.path).catch(() => undefined);
  }
  return readSummary(deps, batchId);
}

async function readSummary(deps: RunImportDeps, batchId: string): Promise<Result<ImportSummary, RunImportError>> {
  const s = await readImport(deps.db, batchId);
  return s ? ok(s) : err('IMPORT_NOT_FOUND');
}

/** What a resume needs, kept with the batch (never a row of the file). */
interface ResumePayload {
  readonly overrides: CsvReadOptions;
  readonly mapping: CsvMapping;
  readonly account: CsvAccountChoice;
  readonly decisions: Readonly<Record<string, RowDecision>>;
}

const asDecisions = (d: Readonly<Record<string, RowDecision>>): Record<number, RowDecision> => Object.fromEntries(Object.entries(d).map(([k, v]) => [Number(k), v]));

/** Reads, validates and plans the file the same way for a first run and a resume. */
async function planFile(deps: Pick<RunImportDeps, 'db' | 'profile'>, bytes: Uint8Array, digest: string, p: ResumePayload) {
  const read = readCsv(bytes, p.overrides);
  if (!read.ok) return null;
  const validated = validateCsvRows(read.value.rows, p.mapping, deps.profile, p.account);
  const context = await loadImportPlanContext(deps.db, validated.rows, digest);
  return planCsvImport(validated.rows, context);
}

/**
 * The plan the `Check matches` step shows: the very same read, validate and plan the run does, so what the person sees is what is
 * imported. Nothing is written. Null when the file cannot be read.
 */
export async function planImportFile(deps: Pick<RunImportDeps, 'db' | 'crypto' | 'profile'>, job: Pick<ImportJob, 'bytes' | 'overrides' | 'mapping' | 'account'>): Promise<ImportPlan | null> {
  const digest = toHex(deps.crypto.sha256(job.bytes));
  return planFile(deps, job.bytes, digest, { overrides: job.overrides, mapping: job.mapping, account: job.account, decisions: {} });
}

/** How many entries an import will create (confirmed, waiting in the review queue or waiting for an amount) with these choices. */
export function entriesToImport(rows: readonly PlannedRow[], decisions: Readonly<Record<number, RowDecision>>): number {
  let n = 0;
  for (const r of rows) {
    const k = actionFor({ class: r.class, decision: decisions[r.row], ...(r.matchId ? { matchId: r.matchId } : {}) }).kind;
    if (k === 'confirm' || k === 'review' || k === 'foreign') n += 1;
  }
  return n;
}

/**
 * Imports a file. The raw copy is written first, then the \`import_batch\` row; a failure before either leaves nothing. Returns the
 * summary of the whole import, or of how far it got when it was stopped.
 */
export async function runCsvImport(deps: RunImportDeps, job: ImportJob): Promise<Result<ImportSummary, RunImportError>> {
  const digest = toHex(deps.crypto.sha256(job.bytes));
  const payload: ResumePayload = { overrides: job.overrides, mapping: job.mapping, account: job.account, decisions: Object.fromEntries(Object.entries(job.decisions)) };
  const plan = await planFile(deps, job.bytes, digest, payload);
  if (plan === null) return err('FILE_NOT_READABLE');

  // AD-9: the encrypted copy is on disk before the row that points at it commits, so a kill in between leaves only an orphan the
  // sweep deletes.
  const retain = deps.retainDays === undefined ? 30 : deps.retainDays;
  const rawPath = await deps.files.save(`import-${digest.slice(0, 16)}-${deps.nowMs()}.enc`, job.bytes);
  const started = await deps.writer.run(
    StartCsvImport,
    {
      fileDigest: digest,
      formatId: job.formatId ?? null,
      resume: payload as unknown as Record<string, unknown>,
      accountId: job.account.kind === 'single' ? job.account.accountId : null,
      rowCount: plan.rows.length,
      rawPath,
      fileName: cleanFileName(job.fileName),
      retainUntil: retain === null ? null : deps.nowMs() + retain * DAY_MS,
    },
    'user',
  );
  if (!started.ok) {
    await deps.files.remove(rawPath).catch(() => undefined);
    return err('IMPORT_FAILED');
  }
  return commitBatches(deps, started.value.batchId, inputRows(plan.rows, job.decisions), 0, plan.rows.length);
}

/** Sets a paused import running again. */
export const ResumeCsvImport: UseCase<{ batchId: string }, { committedThroughRow: number }, 'IMPORT_NOT_FOUND' | 'IMPORT_NOT_RESUMABLE'> = {
  name: 'ResumeCsvImport',
  async execute(ctx, input) {
    const row = (await ctx.query('SELECT status, committed_through_row, raw_path FROM import_batch WHERE id = ?', [input.batchId]))[0];
    if (!row) return err('IMPORT_NOT_FOUND');
    if (String(row[0]) !== 'paused' || row[2] === null) return err('IMPORT_NOT_RESUMABLE');
    await ctx.execute("UPDATE import_batch SET status = 'importing' WHERE id = ?", [input.batchId]);
    ctx.touch('import_batch', input.batchId, { status: 'importing' });
    ctx.emit('ImportsChanged', { batchIds: [input.batchId] });
    return ok({ committedThroughRow: Number(row[1]) });
  },
};

/**
 * Carries on a paused import: re-reads the retained raw copy, verifies it is the file that was imported (its digest), re-plans, and
 * commits from the row after the last committed one. No row is written twice: a row's fingerprint is what makes a repeat harmless.
 */
export async function resumeCsvImport(deps: RunImportDeps, batchId: string): Promise<Result<ImportSummary, RunImportError>> {
  const row = (await deps.db.query('SELECT file_digest, raw_path, mapping_json, row_count FROM import_batch WHERE id = ?', [batchId]))[0];
  if (!row) return err('IMPORT_NOT_FOUND');
  if (row[1] === null) return err('RAW_COPY_MISSING');
  let bytes: Uint8Array;
  try {
    bytes = await deps.files.read(String(row[1]));
  } catch {
    return err('RAW_COPY_MISSING');
  }
  const digest = toHex(deps.crypto.sha256(bytes));
  if (digest !== String(row[0])) return err('FILE_CHANGED');
  const payload = JSON.parse(String(row[2])) as ResumePayload;
  const resumed = await deps.writer.run(ResumeCsvImport, { batchId }, 'user');
  if (!resumed.ok) return err(resumed.code === 'IMPORT_NOT_FOUND' ? 'IMPORT_NOT_FOUND' : 'IMPORT_NOT_RESUMABLE');
  const plan = await planFile(deps, bytes, digest, payload);
  if (plan === null) {
    await deps.writer.run(FinishCsvImport, { batchId, status: 'paused' }, 'user');
    return err('FILE_NOT_READABLE');
  }
  return commitBatches(deps, batchId, inputRows(plan.rows, asDecisions(payload.decisions)), resumed.value.committedThroughRow, plan.rows.length);
}
