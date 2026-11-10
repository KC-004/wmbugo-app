import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import { sha256Hex } from '../shared/sha256';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { normalizeMerchant } from '../capture/merchant';
import { attachmentFileName } from '../capture/attachments';
import { profileTimezone } from './accountCommands';
import { REJECTED_KEEP_DAYS } from './activitySearch';

/**
 * Retention and tombstones (Story 3.12, FIN-014). A deleted entry is kept 30 days, a rejected or merged-away one 90, and
 * then removed for good with its postings, splits, source records, candidates and attachments. A tombstone remembers only a
 * salted hash of the entry's duplicate fingerprint and the outcome, so a rejected or deleted payment is not brought back by
 * the next import. Manual entries are never skipped by a tombstone.
 */

export const DELETED_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
const SALT_KEY = 'tombstone_salt';
const LAST_PURGE_KEY = 'last_purge_date';

export type TombstoneOutcome = 'deleted' | 'rejected';

export interface FingerprintParts {
  readonly reference?: string | null;
  readonly direction: 'debit' | 'credit';
  readonly eventType: string;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchant?: string | null;
}

/** (reference, direction, event type) when a reference exists, else (direction, amount, local date, normalized merchant). */
export function duplicateFingerprint(p: FingerprintParts): string {
  const ref = (p.reference ?? '').trim();
  if (ref !== '') return ['ref', ref.toLowerCase(), p.direction, p.eventType].join('|');
  return ['fields', p.direction, String(p.amountMinor), p.localDate, normalizeMerchant(p.merchant ?? null)].join('|');
}

export const tombstoneHash = (salt: string, fingerprint: string): string => sha256Hex(`${salt}|${fingerprint}`);

/** The per-install salt, created on first use and kept in `settings`. */
export async function tombstoneSalt(ctx: WriterContext): Promise<string> {
  const row = (await ctx.query('SELECT value_json FROM settings WHERE key = ?', [SALT_KEY]))[0];
  if (row) return JSON.parse(String(row[0])) as string;
  const salt = `${ctx.newId()}${ctx.newId()}`;
  await ctx.execute('INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?)', [SALT_KEY, JSON.stringify(salt), ctx.nowMs()]);
  return salt;
}

/** Whether a non-manual item matches a tombstone: the outcome that suppresses it, or null. */
export async function tombstoneFor(ctx: WriterContext, p: FingerprintParts): Promise<TombstoneOutcome | null> {
  const salt = (await ctx.query('SELECT value_json FROM settings WHERE key = ?', [SALT_KEY]))[0];
  if (!salt) return null;
  const hash = tombstoneHash(JSON.parse(String(salt[0])) as string, duplicateFingerprint(p));
  const row = (await ctx.query('SELECT outcome FROM tombstone WHERE fingerprint_hash = ? ORDER BY purged_at DESC LIMIT 1', [hash]))[0];
  return row ? (String(row[0]) as TombstoneOutcome) : null;
}

export type PurgeError = 'ENTRY_NOT_FOUND' | 'NOT_REMOVED';

interface Purged {
  readonly purgedIds: string[];
  /** Attachment files to delete once this has committed. */
  readonly fileNames: string[];
}

/** Removes one removed entry for good and leaves its tombstone. Returns the attachment files to delete after the commit. */
async function purgeOne(ctx: WriterContext, id: string, out: Purged): Promise<void> {
  const t = (await ctx.query('SELECT event_type, amount_minor, local_date, original_description, removal_kind FROM "transaction" WHERE id = ?', [id]))[0];
  if (!t) return;
  const kind = String(t[4]);
  if (kind === 'deleted' || kind === 'rejected') {
    const ref = (await ctx.query("SELECT reference FROM source_record WHERE transaction_id = ? AND reference IS NOT NULL ORDER BY created_at LIMIT 1", [id]))[0];
    const eventType = String(t[0]);
    const hash = tombstoneHash(
      await tombstoneSalt(ctx),
      duplicateFingerprint({ reference: ref ? String(ref[0]) : null, direction: eventType === 'income' || eventType === 'refund' ? 'credit' : 'debit', eventType, amountMinor: Number(t[1]), localDate: String(t[2]), merchant: t[3] === null ? null : String(t[3]) }),
    );
    await ctx.execute('INSERT INTO tombstone (id, fingerprint_hash, outcome, purged_at) VALUES (?, ?, ?, ?)', [ctx.newId(), hash, kind, ctx.nowMs()]);
  }
  for (const a of await ctx.query('SELECT id FROM attachment WHERE transaction_id = ?', [id])) out.fileNames.push(attachmentFileName(String(a[0])));
  // A refund of a purged purchase stays, unlinked, in its own category; its account balance is untouched.
  await ctx.execute('UPDATE "transaction" SET refund_of_transaction_id = NULL WHERE refund_of_transaction_id = ?', [id]);
  await ctx.execute('UPDATE "transaction" SET reversed_by_id = NULL WHERE reversed_by_id = ?', [id]);
  await ctx.execute('DELETE FROM attachment WHERE transaction_id = ?', [id]);
  await ctx.execute('DELETE FROM review_candidate WHERE transaction_id = ?', [id]);
  await ctx.execute('UPDATE review_candidate SET matched_transaction_id = NULL WHERE matched_transaction_id = ?', [id]);
  await ctx.execute('DELETE FROM source_record WHERE transaction_id = ?', [id]);
  await ctx.execute('DELETE FROM split WHERE transaction_id = ?', [id]);
  await ctx.execute('DELETE FROM posting WHERE transaction_id = ?', [id]);
  await ctx.execute('DELETE FROM "transaction" WHERE id = ?', [id]);
  ctx.touch('transaction', id, { purged: true });
  out.purgedIds.push(id);
}

/** Ids past their keeping period at `nowMs`. */
async function expiredIds(ctx: WriterContext, nowMs: number): Promise<string[]> {
  const rows = await ctx.query(
    "SELECT id FROM \"transaction\" WHERE removed_at IS NOT NULL AND ((removal_kind = 'deleted' AND removed_at <= ?) OR (removal_kind IN ('rejected','excluded') AND removed_at <= ?)) ORDER BY removed_at, id",
    [nowMs - DELETED_KEEP_DAYS * DAY_MS, nowMs - REJECTED_KEEP_DAYS * DAY_MS],
  );
  return rows.map((r) => String(r[0]));
}

async function purgeMany(ctx: WriterContext, ids: readonly string[]): Promise<Purged> {
  const out: { purgedIds: string[]; fileNames: string[] } = { purgedIds: [], fileNames: [] };
  for (const id of ids) await purgeOne(ctx, id, out);
  if (out.purgedIds.length > 0) ctx.emit('TransactionsChanged', { transactionIds: out.purgedIds });
  return out;
}

/** Removes everything past its keeping period. Safe to run at any time; exact day boundaries are tested with the Clock. */
export const PurgeExpired: UseCase<Record<string, never>, Purged, never> = {
  name: 'PurgeExpired',
  async execute(ctx) {
    return ok(await purgeMany(ctx, await expiredIds(ctx, ctx.nowMs())));
  },
};

/** Delete permanently (Story 3.13): purges one removed entry now, with the same tombstone rule. */
export const PurgeEntry: UseCase<{ transactionId: string }, Purged, PurgeError> = {
  name: 'PurgeEntry',
  async execute(ctx, input) {
    const t = (await ctx.query('SELECT removed_at FROM "transaction" WHERE id = ?', [input.transactionId]))[0];
    if (!t) return err('ENTRY_NOT_FOUND');
    if (t[0] === null) return err('NOT_REMOVED');
    return ok(await purgeMany(ctx, [input.transactionId]));
  },
};

/** At most once per local day (app start or resume): runs `PurgeExpired` and records the day in the same transaction. */
export const RunDailyPurge: UseCase<Record<string, never>, Purged & { ran: boolean }, never> = {
  name: 'RunDailyPurge',
  async execute(ctx) {
    const tz = await profileTimezone(ctx);
    if (tz === null) return ok({ ran: false, purgedIds: [], fileNames: [] });
    const today = toLocalDate(ctx.nowMs(), tz);
    if (!today.ok) return ok({ ran: false, purgedIds: [], fileNames: [] });
    const last = (await ctx.query('SELECT value_json FROM settings WHERE key = ?', [LAST_PURGE_KEY]))[0];
    if (last && JSON.parse(String(last[0])) === today.value) return ok({ ran: false, purgedIds: [], fileNames: [] });
    const purged = await purgeMany(ctx, await expiredIds(ctx, ctx.nowMs()));
    await ctx.execute('INSERT INTO settings (key, value_json, version, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [LAST_PURGE_KEY, JSON.stringify(today.value), ctx.nowMs()]);
    return ok({ ran: true, ...purged });
  },
};
