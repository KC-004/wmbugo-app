import type { Querier } from '../../planning/budgets';
import { IMPORT_RETENTION_CHOICES, SETTING_IMPORT_RETENTION, type ImportRetention } from '../../profile/settings';
import { err, ok } from '../../shared/result';
import type { UseCase, WriterContext } from '../../writer/ledgerWriter';

/**
 * The encrypted copies of imported files (Story 9.8, IMP-006, SET-004). A copy is kept 30 days by default, or until the person
 * deletes it, or not at all. Deleting a copy never touches the entries imported from it, and never touches `import_batch` rows or
 * source fingerprints, so importing the same file again stays harmless. Use cases clear `raw_path` and return the paths; the
 * caller deletes the files once the commit is done.
 */
const DAY_MS = 86_400_000;
export const IMPORT_KEEP_DAYS = 30;

/** When a completed import's copy expires under a choice: right away, 30 days after it completed, or never. */
export function retainUntilFor(choice: ImportRetention, completedAtMs: number): number | null {
  if (choice === 'delete_after') return completedAtMs;
  if (choice === 'days_30') return completedAtMs + IMPORT_KEEP_DAYS * DAY_MS;
  return null;
}

/** The `retainDays` an import run takes for a choice: 0 deletes right after, null keeps until deleted. */
export function retainDaysFor(choice: ImportRetention): number | null {
  return choice === 'delete_after' ? 0 : choice === 'days_30' ? IMPORT_KEEP_DAYS : null;
}

/** A display name from a picker: no folders, no control characters, at most 120 characters; null when nothing is left. */
export function cleanFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base === '' ? null : base.slice(0, 120);
}

async function clearRawCopy(ctx: WriterContext, batchId: string): Promise<void> {
  await ctx.execute('UPDATE import_batch SET raw_path = NULL WHERE id = ?', [batchId]);
  ctx.touch('import_batch', batchId, { rawCopy: 'deleted' });
  ctx.emit('ImportsChanged', { batchIds: [batchId] });
}

export type DeleteImportFileError = 'IMPORT_NOT_FOUND' | 'IMPORT_IN_PROGRESS' | 'NO_FILE';

/** `Delete file now`: removes a finished import's copy. A paused import keeps its copy: Resume needs it (Discard is its own choice). */
export const DeleteImportFile: UseCase<{ batchId: string }, { path: string }, DeleteImportFileError> = {
  name: 'DeleteImportFile',
  async execute(ctx, input) {
    const r = (await ctx.query('SELECT status, raw_path FROM import_batch WHERE id = ?', [input.batchId]))[0];
    if (!r) return err('IMPORT_NOT_FOUND');
    if (r[0] !== 'completed' && r[0] !== 'abandoned') return err('IMPORT_IN_PROGRESS');
    if (r[1] === null) return err('NO_FILE');
    await clearRawCopy(ctx, input.batchId);
    return ok({ path: String(r[1]) });
  },
};

/** Right after a completing commit under `Deleted after import`: the copy goes, if the import really is finished. Nothing to do otherwise. */
export const DropImportRawCopy: UseCase<{ batchId: string }, { path: string | null }, never> = {
  name: 'DropImportRawCopy',
  async execute(ctx, input) {
    const r = (await ctx.query('SELECT status, raw_path FROM import_batch WHERE id = ?', [input.batchId]))[0];
    if (!r || (r[0] !== 'completed' && r[0] !== 'abandoned') || r[1] === null) return ok({ path: null });
    await clearRawCopy(ctx, input.batchId);
    return ok({ path: String(r[1]) });
  },
};

/** Gives up an import that was paused or never finished: it is abandoned and its copy goes. The entries already added stay. */
export const DiscardImport: UseCase<{ batchId: string }, { path: string | null }, 'IMPORT_NOT_FOUND'> = {
  name: 'DiscardImport',
  async execute(ctx, input) {
    const r = (await ctx.query('SELECT status, raw_path FROM import_batch WHERE id = ?', [input.batchId]))[0];
    if (!r) return err('IMPORT_NOT_FOUND');
    if (r[0] === 'completed' || r[0] === 'abandoned') return ok({ path: null });
    await ctx.execute("UPDATE import_batch SET status = 'abandoned', completed_at = ?, raw_path = NULL, retain_until = NULL WHERE id = ?", [ctx.nowMs(), input.batchId]);
    ctx.touch('import_batch', input.batchId, { status: 'abandoned' });
    ctx.emit('ImportsChanged', { batchIds: [input.batchId] });
    return ok({ path: r[1] === null ? null : String(r[1]) });
  },
};

/**
 * Chooses how long copies are kept (profile-owned). It applies to existing finished imports from now: each expiry is worked out again
 * from when the import completed, and a copy whose time has already passed goes at once. Returns the files to delete after the commit.
 */
export const SetImportRetention: UseCase<{ choice: ImportRetention }, { paths: string[] }, 'SETTING_INVALID'> = {
  name: 'SetImportRetention',
  async execute(ctx, input) {
    if (!IMPORT_RETENTION_CHOICES.includes(input.choice)) return err('SETTING_INVALID');
    await ctx.execute(
      'INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, version = version + 1, updated_at = excluded.updated_at',
      [SETTING_IMPORT_RETENTION, JSON.stringify(input.choice), ctx.nowMs()],
    );
    const paths: string[] = [];
    const finished = await ctx.query("SELECT id, completed_at, raw_path FROM import_batch WHERE status IN ('completed','abandoned') AND completed_at IS NOT NULL");
    for (const r of finished) {
      const until = retainUntilFor(input.choice, Number(r[1]));
      const expired = r[2] !== null && until !== null && until <= ctx.nowMs();
      await ctx.execute('UPDATE import_batch SET retain_until = ?, raw_path = ? WHERE id = ?', [until, expired ? null : (r[2] as string | null), String(r[0])]);
      if (expired) paths.push(String(r[2]));
    }
    ctx.touch('settings', SETTING_IMPORT_RETENTION, { changed: true });
    ctx.emit('ProfileChanged', { fields: [SETTING_IMPORT_RETENTION] });
    if (finished.length > 0) ctx.emit('ImportsChanged', { batchIds: finished.map((r) => String(r[0])) });
    return ok({ paths });
  },
};

/** Copies past their keeping time (a finished import whose `retain_until` has passed): cleared here, deleted by the caller after the commit. */
export async function purgeExpiredImportFiles(ctx: WriterContext): Promise<string[]> {
  const rows = await ctx.query("SELECT id, raw_path FROM import_batch WHERE status IN ('completed','abandoned') AND raw_path IS NOT NULL AND retain_until IS NOT NULL AND retain_until <= ?", [ctx.nowMs()]);
  const paths: string[] = [];
  for (const r of rows) {
    await ctx.execute('UPDATE import_batch SET raw_path = NULL WHERE id = ?', [String(r[0])]);
    ctx.touch('import_batch', String(r[0]), { rawCopy: 'expired' });
    paths.push(String(r[1]));
  }
  if (rows.length > 0) ctx.emit('ImportsChanged', { batchIds: rows.map((r) => String(r[0])) });
  return paths;
}

export interface ImportListItem {
  readonly batchId: string;
  readonly fileName: string | null;
  readonly status: 'planned' | 'importing' | 'paused' | 'completed' | 'abandoned';
  readonly createdAt: number;
  readonly completedAt: number | null;
  /** Entries this import created (added and waiting to be checked). */
  readonly entries: number;
  readonly hasFile: boolean;
  /** When the copy goes; null with a copy means until the person deletes it. */
  readonly keptUntil: number | null;
}

/** Every import, newest first, for Settings > Data > Imported files. */
export async function listImports(db: Querier): Promise<ImportListItem[]> {
  const rows = await db.query('SELECT id, file_name, status, created_at, completed_at, imported_count, review_count, raw_path, retain_until FROM import_batch ORDER BY created_at DESC, id DESC');
  return rows.map((r) => ({
    batchId: String(r[0]),
    fileName: r[1] === null ? null : String(r[1]),
    status: String(r[2]) as ImportListItem['status'],
    createdAt: Number(r[3]),
    completedAt: r[4] === null ? null : Number(r[4]),
    entries: Number(r[5]) + Number(r[6]),
    hasFile: r[7] !== null,
    keptUntil: r[8] === null ? null : Number(r[8]),
  }));
}
