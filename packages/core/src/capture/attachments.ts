import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';

/**
 * Receipt photos and source details (Story 3.11, TXN-011). The image is an encrypted file in app-private storage named by
 * the attachment id; the `attachment` row keeps it. The file is written BEFORE the row commits, so a kill in between leaves
 * only an unreferenced file, which the orphan sweep deletes at the next start.
 */

export interface Attachment {
  readonly id: string;
  readonly transactionId: string;
  readonly kind: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly createdAt: number;
}

/** An entry's attachments, oldest first. Param: transaction id. */
export const ATTACHMENTS_SQL = 'SELECT id, transaction_id, kind, digest, size_bytes, created_at FROM attachment WHERE transaction_id = ? ORDER BY created_at, id';

/** Every attachment id in the database (the orphan sweep keeps these files). */
export const ATTACHMENT_IDS_SQL = 'SELECT id FROM attachment';

export function mapAttachments(rows: readonly (readonly unknown[])[]): Attachment[] {
  return rows.map((r) => ({ id: String(r[0]), transactionId: String(r[1]), kind: String(r[2]), digest: String(r[3]), sizeBytes: Number(r[4]), createdAt: Number(r[5]) }));
}

/** A file name in the attachments folder is `<attachment id>.enc`. */
export const attachmentFileName = (attachmentId: string): string => `${attachmentId}.enc`;

/** Files in the attachments folder that no `attachment` row refers to: the orphan sweep deletes them. */
export function orphanFiles(fileNames: readonly string[], referencedIds: ReadonlySet<string>): string[] {
  return fileNames.filter((f) => f.endsWith('.enc') && !referencedIds.has(f.slice(0, -4)));
}

/** Every source of an entry with its kind and time. Param: transaction id. */
export const SOURCES_SQL = 'SELECT source_kind, created_at, reference FROM source_record WHERE transaction_id = ? ORDER BY created_at, id';

export interface SourceLine {
  readonly kind: string;
  readonly atMs: number;
  readonly reference: string | null;
}

export function mapSources(rows: readonly (readonly unknown[])[]): SourceLine[] {
  return rows.map((r) => ({ kind: String(r[0]), atMs: Number(r[1]), reference: r[2] === null ? null : String(r[2]) }));
}

export type AttachError = 'ENTRY_NOT_FOUND' | 'ENTRY_REMOVED' | 'ALREADY_ATTACHED' | 'DIGEST_INVALID' | 'SIZE_INVALID';

/**
 * Records a photo that is already encrypted on disk. `ALREADY_ATTACHED` when the same image (digest) is on this entry:
 * nothing is written and the caller deletes the file it just wrote.
 */
export const AddAttachment: UseCase<{ transactionId: string; attachmentId: string; digest: string; sizeBytes: number }, { attachmentId: string }, AttachError> = {
  name: 'AddAttachment',
  async execute(ctx, input) {
    if (!/^[0-9a-f]{64}$/.test(input.digest)) return err('DIGEST_INVALID');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) return err('SIZE_INVALID');
    const t = (await ctx.query('SELECT removed_at FROM "transaction" WHERE id = ?', [input.transactionId]))[0];
    if (!t) return err('ENTRY_NOT_FOUND');
    if (t[0] !== null) return err('ENTRY_REMOVED');
    if ((await ctx.query('SELECT 1 FROM attachment WHERE transaction_id = ? AND digest = ?', [input.transactionId, input.digest]))[0]) return err('ALREADY_ATTACHED');
    await ctx.execute('INSERT INTO attachment (id, transaction_id, kind, digest, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', [input.attachmentId, input.transactionId, 'receipt', input.digest, input.sizeBytes, ctx.nowMs()]);
    ctx.touch('transaction', input.transactionId, { attachmentAdded: true });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok({ attachmentId: input.attachmentId });
  },
};

/** Deletes the row. The caller deletes the file after this commits; the entry is otherwise unchanged. */
export const RemoveAttachment: UseCase<{ attachmentId: string }, { transactionId: string; fileName: string }, 'ATTACHMENT_NOT_FOUND'> = {
  name: 'RemoveAttachment',
  async execute(ctx, input) {
    const row = (await ctx.query('SELECT transaction_id FROM attachment WHERE id = ?', [input.attachmentId]))[0];
    if (!row) return err('ATTACHMENT_NOT_FOUND');
    const transactionId = String(row[0]);
    await ctx.execute('DELETE FROM attachment WHERE id = ?', [input.attachmentId]);
    ctx.touch('transaction', transactionId, { attachmentRemoved: true });
    ctx.emit('TransactionsChanged', { transactionIds: [transactionId] });
    return ok({ transactionId, fileName: attachmentFileName(input.attachmentId) });
  },
};

/**
 * A merge carries every attachment of the merged-away entry to the survivor, deduplicated by digest (a photo the survivor
 * already has is dropped; its file becomes an orphan and is swept).
 */
export interface DroppedAttachment {
  readonly id: string;
  readonly transactionId: string;
  readonly kind: string;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly createdAt: number;
}

export async function moveAttachments(ctx: WriterContext, fromId: string, toId: string): Promise<DroppedAttachment[]> {
  const dropped: DroppedAttachment[] = [];
  const mine = new Set((await ctx.query('SELECT digest FROM attachment WHERE transaction_id = ?', [toId])).map((r) => String(r[0])));
  for (const r of await ctx.query('SELECT id, digest, kind, size_bytes, created_at FROM attachment WHERE transaction_id = ?', [fromId])) {
    if (mine.has(String(r[1]))) {
      dropped.push({ id: String(r[0]), transactionId: fromId, kind: String(r[2]), digest: String(r[1]), sizeBytes: Number(r[3]), createdAt: Number(r[4]) });
      await ctx.execute('DELETE FROM attachment WHERE id = ?', [String(r[0])]);
    } else await ctx.execute('UPDATE attachment SET transaction_id = ? WHERE id = ?', [toId, String(r[0])]);
  }
  return dropped;
}
