import { err, ok } from '../../shared/result';
import { localToInstant } from '../../shared/clock';
import { getCurrency } from '../../shared/currency';
import { categoryFits, UNCATEGORISED_ID } from '../../ledger/categories';
import { profileTimezone } from '../../ledger/accountCommands';
import type { UseCase, WriterContext } from '../../writer/ledgerWriter';
import { SubmitCapture, type CsvRowMeta, type SubmitInput } from '../submitCapture';
import { anywayFingerprint, type ImportClass } from './plan';
import type { CsvCandidate } from './rows';

/**
 * ImportCsvBatch (Story 9.4, IMP-005, AD-6, AD-3): the commit side of a CSV import. Nothing here chooses what happens to a row: the
 * plan (Story 9.3) classified it and the person decided; this commits it. Each batch is one writer transaction that submits every row
 * through `SubmitCapture` and advances `committed_through_row` in the same commit, so a killed import resumes at the next row with
 * nothing written twice.
 */

/** What the person chose for a row. `default` is the class's own default (see `actionFor`). */
export type RowDecision = 'default' | 'check_later' | 'import_anyway' | 'skip';

export interface ImportInputRow {
  readonly row: number;
  readonly class: ImportClass;
  readonly decision?: RowDecision;
  readonly candidate: CsvCandidate | null;
  readonly fingerprint: string | null;
  /** The existing entry a duplicate, pair or match points at. */
  readonly matchId?: string;
  /** For a transfer pair inside the file: the other row's fingerprint, so the second leg can point at the first. */
  readonly pairFingerprint?: string;
  /** Error codes for an `error` row, recorded with its row number and never its text. */
  readonly errorCodes?: readonly string[];
}

/**
 * Income has no `Uncategorised` category, so an income row the file gave no usable category for is filed under the least specific one
 * (`From people`) and flagged as needing a category, which is what puts it in front of the person.
 */
const INCOME_FALLBACK_ID = 'cat_in_people';

/** How many rows one batch holds at most. */
export const IMPORT_BATCH_ROWS = 500;

export type RowAction =
  | { readonly kind: 'confirm'; readonly ignoreTombstone?: boolean }
  | { readonly kind: 'review'; readonly reason: 'duplicate' | 'held_pair' | 'edge_day' | 'transfer_pair' }
  | { readonly kind: 'foreign' }
  | { readonly kind: 'exclude' }
  | { readonly kind: 'link' }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'error' };

/** What a row's class and the person's decision come to. Pure. */
export function actionFor(row: Pick<ImportInputRow, 'class' | 'decision' | 'matchId'>): RowAction {
  const d = row.decision ?? 'default';
  switch (row.class) {
    case 'error':
      return { kind: 'error' };
    case 'already_recorded':
      return row.matchId ? { kind: 'link' } : { kind: 'nothing' };
    case 'previously_rejected':
    case 'previously_deleted':
      return d === 'import_anyway' ? { kind: 'confirm', ignoreTombstone: true } : { kind: 'nothing' };
    case 'new':
      return d === 'skip' ? { kind: 'exclude' } : { kind: 'confirm' };
    case 'foreign_currency':
      return d === 'skip' ? { kind: 'exclude' } : { kind: 'foreign' };
    case 'possible_duplicate':
      return d === 'skip' ? { kind: 'exclude' } : d === 'import_anyway' ? { kind: 'confirm' } : { kind: 'review', reason: 'duplicate' };
    case 'transfer_pair':
      return d === 'skip' ? { kind: 'exclude' } : d === 'import_anyway' ? { kind: 'confirm' } : { kind: 'review', reason: 'transfer_pair' };
    case 'held_pair':
      return d === 'skip' ? { kind: 'exclude' } : d === 'import_anyway' ? { kind: 'confirm' } : { kind: 'review', reason: 'held_pair' };
    case 'edge_day_review':
      return d === 'skip' ? { kind: 'exclude' } : d === 'import_anyway' ? { kind: 'confirm' } : { kind: 'review', reason: 'edge_day' };
  }
}

export type ImportStatus = 'planned' | 'importing' | 'paused' | 'completed' | 'abandoned';

export interface StartCsvImportInput {
  readonly fileDigest: string;
  readonly formatId?: string | null;
  /** Everything a resume needs: the layout, the reader overrides, the account choice and the person's per-row decisions. Never a row. */
  readonly resume: Record<string, unknown>;
  readonly accountId?: string | null;
  readonly rowCount: number;
  readonly rawPath: string | null;
  readonly retainUntil: number | null;
  /** The file's display name (Story 9.8), already cleaned. */
  readonly fileName?: string | null;
}

/** Creates the `import_batch` row, after the raw copy is safely on disk (AD-9). */
export const StartCsvImport: UseCase<StartCsvImportInput, { batchId: string }, 'IMPORT_INVALID'> = {
  name: 'StartCsvImport',
  async execute(ctx, input) {
    if (!/^[0-9a-f]{64}$/.test(input.fileDigest) || !Number.isSafeInteger(input.rowCount) || input.rowCount < 0) return err('IMPORT_INVALID');
    const id = ctx.newId();
    await ctx.execute(
      "INSERT INTO import_batch (id, file_digest, format_id, mapping_json, account_id, status, row_count, raw_path, file_name, retain_until, created_at) VALUES (?, ?, ?, ?, ?, 'importing', ?, ?, ?, ?, ?)",
      [id, input.fileDigest, input.formatId ?? null, JSON.stringify(input.resume), input.accountId ?? null, input.rowCount, input.rawPath, input.fileName ?? null, input.retainUntil, ctx.nowMs()],
    );
    ctx.touch('import_batch', id, { created: true });
    ctx.emit('ImportsChanged', { batchIds: [id] });
    return ok({ batchId: id });
  },
};

export type FinishStatus = 'completed' | 'paused' | 'abandoned';

export const FinishCsvImport: UseCase<{ batchId: string; status: FinishStatus }, void, 'IMPORT_NOT_FOUND'> = {
  name: 'FinishCsvImport',
  async execute(ctx, input) {
    const row = (await ctx.query('SELECT status FROM import_batch WHERE id = ?', [input.batchId]))[0];
    if (!row) return err('IMPORT_NOT_FOUND');
    const done = input.status !== 'paused';
    await ctx.execute('UPDATE import_batch SET status = ?, completed_at = ? WHERE id = ?', [input.status, done ? ctx.nowMs() : null, input.batchId]);
    ctx.touch('import_batch', input.batchId, { status: input.status });
    ctx.emit('ImportsChanged', { batchIds: [input.batchId] });
    return ok(undefined);
  },
};

/** At every start: an import that was running when the process died is paused, ready for Resume. */
export const PauseInterruptedImports: UseCase<Record<string, never>, { paused: number }, never> = {
  name: 'PauseInterruptedImports',
  async execute(ctx) {
    const rows = await ctx.query("SELECT id FROM import_batch WHERE status = 'importing'");
    for (const r of rows) {
      await ctx.execute("UPDATE import_batch SET status = 'paused' WHERE id = ?", [String(r[0])]);
      ctx.touch('import_batch', String(r[0]), { status: 'paused' });
    }
    if (rows.length > 0) ctx.emit('ImportsChanged', { batchIds: rows.map((r) => String(r[0])) });
    return ok({ paused: rows.length });
  },
};

export interface ImportBatchInput {
  readonly batchId: string;
  /** At most `IMPORT_BATCH_ROWS`, in file order. */
  readonly rows: readonly ImportInputRow[];
  /** The last file row this batch covers: `committed_through_row` becomes this in the same commit. */
  readonly throughRow: number;
}

export interface ImportBatchResult {
  readonly imported: number;
  readonly skipped: number;
  readonly review: number;
  readonly errors: number;
}

export type ImportBatchError = 'IMPORT_NOT_FOUND' | 'IMPORT_NOT_RUNNING' | 'BATCH_TOO_LARGE' | 'BATCH_OUT_OF_ORDER';

/** category name (as written in the file, lower case) to its id, for the categories wmbugo has. */
async function categoriesByName(ctx: WriterContext): Promise<Map<string, { id: string; kind: string }>> {
  const out = new Map<string, { id: string; kind: string }>();
  for (const r of await ctx.query('SELECT id, name, kind FROM category WHERE archived = 0')) out.set(String(r[1]).trim().toLowerCase(), { id: String(r[0]), kind: String(r[2]) });
  return out;
}

async function rowError(ctx: WriterContext, batchId: string, fileRow: number, code: string): Promise<void> {
  await ctx.execute('INSERT INTO import_row_error (id, import_batch_id, file_row, code, created_at) VALUES (?, ?, ?, ?, ?)', [ctx.newId(), batchId, fileRow, code, ctx.nowMs()]);
}

/**
 * Commits one batch (at most 500 rows) in the writer's transaction. A row that cannot be committed (its account was archived since
 * the plan) is recorded with its row number and a code and the rest of the batch goes ahead; nothing is dropped silently.
 */
export const ImportCsvBatch: UseCase<ImportBatchInput, ImportBatchResult, ImportBatchError> = {
  name: 'ImportCsvBatch',
  async execute(ctx, input) {
    if (input.rows.length > IMPORT_BATCH_ROWS) return err('BATCH_TOO_LARGE');
    const batch = (await ctx.query('SELECT status, committed_through_row FROM import_batch WHERE id = ?', [input.batchId]))[0];
    if (!batch) return err('IMPORT_NOT_FOUND');
    if (String(batch[0]) !== 'importing') return err('IMPORT_NOT_RUNNING');
    // A batch must start after the last committed row and be in order: a resume can never write a row twice or skip one.
    const rows = [...input.rows].sort((a, b) => a.row - b.row);
    if (rows.length > 0 && (rows[0]!.row <= Number(batch[1]) || input.throughRow < rows[rows.length - 1]!.row)) return err('BATCH_OUT_OF_ORDER');

    const tz = await profileTimezone(ctx);
    const categories = await categoriesByName(ctx);
    const result = { imported: 0, skipped: 0, review: 0, errors: 0 };

    for (const r of rows) {
      const action = actionFor(r);
      if (action.kind === 'error') {
        for (const code of r.errorCodes?.length ? r.errorCodes : ['INVALID_ROW']) await rowError(ctx, input.batchId, r.row, code);
        result.errors += 1;
        continue;
      }
      if (action.kind === 'nothing') {
        result.skipped += 1;
        continue;
      }
      const c = r.candidate;
      if (c === null || r.fingerprint === null) {
        await rowError(ctx, input.batchId, r.row, 'INVALID_ROW');
        result.errors += 1;
        continue;
      }
      if (action.kind === 'link') {
        // The same payment is already in the ledger: this file's row becomes one more source of it.
        const have = (await ctx.query('SELECT 1 FROM source_record WHERE fingerprint = ?', [r.fingerprint]))[0];
        if (!have && r.matchId) {
          await ctx.execute('INSERT INTO source_record (id, transaction_id, source_kind, fingerprint, reference, created_at, import_batch_id, file_row) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
            ctx.newId(),
            r.matchId,
            'csv',
            r.fingerprint,
            c.reference ?? null,
            ctx.nowMs(),
            input.batchId,
            r.row,
          ]);
        }
        result.skipped += 1;
        continue;
      }
      if (c.accountId === null || tz === null) {
        await rowError(ctx, input.batchId, r.row, c.accountId === null ? 'ACCOUNT_NOT_FOUND' : 'NO_PROFILE');
        result.errors += 1;
        continue;
      }

      const kind = c.direction === 'out' ? 'expense' : 'income';
      const named = c.categoryName === undefined ? undefined : categories.get(c.categoryName.trim().toLowerCase());
      const known = named !== undefined && categoryFits(named.kind, kind);
      const categoryId = known ? named.id : kind === 'expense' ? UNCATEGORISED_ID : INCOME_FALLBACK_ID;
      const at = c.instantMs ?? (() => {
        const i = localToInstant(c.localDate, 12, 0, tz);
        return i.ok ? i.value : Date.UTC(Number(c.localDate.slice(0, 4)), Number(c.localDate.slice(5, 7)) - 1, Number(c.localDate.slice(8, 10)), 12);
      })();

      let pairMatch: string | null = null;
      if (action.kind === 'review' && action.reason === 'transfer_pair' && r.pairFingerprint) {
        const first = (await ctx.query('SELECT transaction_id FROM source_record WHERE fingerprint = ?', [r.pairFingerprint]))[0];
        if (first) pairMatch = String(first[0]);
      }
      const csv: CsvRowMeta = {
        batchId: input.batchId,
        fileRow: r.row,
        ...(action.kind === 'review' ? { review: { reason: action.reason, matchedTransactionId: pairMatch ?? r.matchId ?? null } } : {}),
        ...(action.kind === 'confirm' && !known ? { needsCategory: true } : {}),
        ...(action.kind === 'exclude' ? { excluded: true } : {}),
        ...(action.kind === 'foreign' || (action.kind === 'exclude' && c.foreign)
          ? { foreign: { amountMinor: c.amountMinor, currency: c.currency, exponent: exponentOf(c) } }
          : {}),
      };
      // Import anyway on a row whose removed entry is still in the ledger: that entry holds the fingerprint, so the new one gets its own.
      let submissionId = r.fingerprint;
      if (action.kind === 'confirm' && action.ignoreTombstone && (await ctx.query('SELECT 1 FROM source_record WHERE fingerprint = ?', [r.fingerprint]))[0]) {
        submissionId = anywayFingerprint(r.fingerprint);
      }
      const submit: SubmitInput = {
        submissionId,
        sourceKind: 'csv',
        ...(c.reference ? { reference: c.reference } : {}),
        ...(action.kind === 'confirm' && action.ignoreTombstone ? { ignoreTombstone: true } : {}),
        csv,
        entry: { kind, amountMinor: c.amountMinor, categoryId, accountId: c.accountId, merchant: c.description === '' ? c.merchant : c.description, occurredAtMs: at },
      };
      const s = await SubmitCapture.execute(ctx, submit);
      if (!s.ok) {
        await rowError(ctx, input.batchId, r.row, s.code);
        result.errors += 1;
        continue;
      }
      if (s.value.result === 'ALREADY_SUBMITTED' || s.value.result === 'SKIPPED_PREVIOUSLY_REJECTED' || s.value.result === 'SKIPPED_PREVIOUSLY_DELETED') result.skipped += 1;
      else if (action.kind === 'exclude') result.skipped += 1;
      else if (action.kind === 'review' || action.kind === 'foreign') result.review += 1;
      else result.imported += 1;

      // The second leg of a transfer inside the file: the first leg's open candidate now points at it.
      if (pairMatch) {
        await ctx.execute("UPDATE review_candidate SET matched_transaction_id = ? WHERE transaction_id = ? AND reason = 'transfer_pair' AND status = 'open' AND matched_transaction_id IS NULL", [s.value.transactionId, pairMatch]);
      }
    }

    await ctx.execute(
      'UPDATE import_batch SET committed_through_row = ?, imported_count = imported_count + ?, skipped_count = skipped_count + ?, review_count = review_count + ?, error_count = error_count + ? WHERE id = ?',
      [Math.max(input.throughRow, Number(batch[1])), result.imported, result.skipped, result.review, result.errors, input.batchId],
    );
    ctx.touch('import_batch', input.batchId, { through: input.throughRow });
    return ok(result);
  },
};

/** The decimals of the row's currency (the amount was already parsed with them when the row was validated). */
function exponentOf(c: CsvCandidate): number {
  const cur = getCurrency(c.currency);
  return cur.ok ? cur.value.exponent : 2;
}
