import { toLocalDate } from '../shared/clock';
import { err, ok } from '../shared/result';
import type { Invariant, UseCase } from '../writer/ledgerWriter';
import { insertAccount, profileTimezone } from './accountCommands';

export type EntryKind = 'expense' | 'income';

export const PAYMENT_METHODS = ['upi', 'card', 'cash', 'bank_transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface ManualEntry {
  readonly kind: EntryKind;
  /** Magnitude in minor units, greater than zero. */
  readonly amountMinor: number;
  readonly categoryId: string;
  /** The account the money moves in or out of. null only when no account exists: Cash is then created. */
  readonly accountId: string | null;
  readonly merchant?: string;
  readonly note?: string;
  readonly paymentMethod?: PaymentMethod;
  /** UTC instant; defaults to now. */
  readonly occurredAtMs?: number;
}

export type RecordEntryError =
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_INVALID'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_KIND_MISMATCH'
  | 'ACCOUNT_REQUIRED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'NO_PROFILE'
  | 'INSTANT_INVALID'
  | 'PAYMENT_METHOD_INVALID';

export const MAX_NOTE_LENGTH = 500;
export const MAX_MERCHANT_LENGTH = 120;

const clean = (s: string | undefined, max: number): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t.slice(0, max);
};

/**
 * Records one confirmed expense or income: the transaction (UTC instant, capture timezone, fixed local
 * date), one posting on the account (negative out, positive in) and one split equal to the amount, with
 * audit and `TransactionsChanged` in the writer's single transaction. With no account yet, Cash is created
 * (balance not set) in the same save.
 */
export const RecordManualEntry: UseCase<ManualEntry, { transactionId: string; accountId: string }, RecordEntryError> = {
  name: 'RecordManualEntry',
  async execute(ctx, input) {
    if (!Number.isSafeInteger(input.amountMinor)) return err('AMOUNT_INVALID');
    if (input.amountMinor <= 0) return err('AMOUNT_REQUIRED');
    if (input.paymentMethod !== undefined && !PAYMENT_METHODS.includes(input.paymentMethod)) return err('PAYMENT_METHOD_INVALID');

    const tz = await profileTimezone(ctx);
    if (tz === null) return err('NO_PROFILE');

    const cat = (await ctx.query('SELECT kind FROM category WHERE id = ? AND archived = 0', [input.categoryId]))[0];
    if (!cat) return err('CATEGORY_NOT_FOUND');
    if (String(cat[0]) !== input.kind) return err('CATEGORY_KIND_MISMATCH');

    const at = input.occurredAtMs ?? ctx.nowMs();
    const date = toLocalDate(at, tz);
    if (!date.ok) return err('INSTANT_INVALID');

    let accountId = input.accountId;
    let createdAccount = false;
    if (accountId === null) {
      const active = Number((await ctx.query("SELECT COUNT(*) FROM account WHERE status = 'active'"))[0]?.[0] ?? 0);
      if (active > 0) return err('ACCOUNT_REQUIRED');
      accountId = (await insertAccount(ctx, { name: 'Cash', type: 'cash', openingMinor: null }, tz)).accountId;
      createdAccount = true;
    } else {
      const acc = (await ctx.query('SELECT status FROM account WHERE id = ?', [accountId]))[0];
      if (!acc) return err('ACCOUNT_NOT_FOUND');
      if (String(acc[0]) !== 'active') return err('ACCOUNT_ARCHIVED');
    }

    const now = ctx.nowMs();
    const transactionId = ctx.newId();
    const signed = input.kind === 'expense' ? -input.amountMinor : input.amountMinor;
    await ctx.execute(
      "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, original_description, note, payment_method, tags_json, needs_category, created_at, updated_at) VALUES (?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)",
      [
        transactionId,
        input.kind,
        input.amountMinor,
        at,
        date.value,
        tz,
        clean(input.merchant, MAX_MERCHANT_LENGTH),
        clean(input.note, MAX_NOTE_LENGTH),
        input.paymentMethod ?? null,
        now,
        now,
      ],
    );
    await ctx.execute(
      "INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, 'normal')",
      [ctx.newId(), transactionId, accountId, input.kind === 'expense' ? 'out' : 'in', signed],
    );
    await ctx.execute('INSERT INTO split (id, transaction_id, category_id, amount_minor) VALUES (?, ?, ?, ?)', [
      ctx.newId(),
      transactionId,
      input.categoryId,
      input.amountMinor,
    ]);
    ctx.touch('transaction', transactionId, { eventType: input.kind, created: true });
    ctx.emit('TransactionsChanged', { transactionIds: [transactionId] });
    if (createdAccount) ctx.emit('AccountsChanged', { accountIds: [accountId] });
    return ok({ transactionId, accountId });
  },
};

/** Undo for a new entry: marks it removed (`deleted`), so every total ignores it. The rows stay for audit. */
export const RemoveEntry: UseCase<{ transactionId: string }, void, 'ENTRY_NOT_FOUND' | 'ALREADY_REMOVED'> = {
  name: 'RemoveEntry',
  async execute(ctx, input) {
    const row = (await ctx.query('SELECT removed_at FROM "transaction" WHERE id = ?', [input.transactionId]))[0];
    if (!row) return err('ENTRY_NOT_FOUND');
    if (row[0] !== null) return err('ALREADY_REMOVED');
    const at = ctx.nowMs();
    await ctx.execute("UPDATE \"transaction\" SET removed_at = ?, removal_kind = 'deleted', updated_at = ? WHERE id = ?", [at, at, input.transactionId]);
    ctx.touch('transaction', input.transactionId, { removed: 'deleted' });
    ctx.emit('TransactionsChanged', { transactionIds: [input.transactionId] });
    return ok(undefined);
  },
};

/**
 * Ledger invariant for user entries: an expense or income has exactly one posting with the right sign and
 * the transaction's amount, and its splits add up to the amount.
 */
export const entryShape: Invariant = {
  name: 'entryShape',
  async check(ctx) {
    const ids = ctx.touched.filter((t) => t.entityKind === 'transaction').map((t) => t.entityId);
    for (const id of ids) {
      const t = (await ctx.query('SELECT event_type, amount_minor FROM "transaction" WHERE id = ?', [id]))[0];
      if (t && String(t[0]) === 'transfer') {
        const p = await ctx.query('SELECT signed_amount_minor FROM posting WHERE transaction_id = ? ORDER BY signed_amount_minor', [id]);
        const amount = Number(t[1]);
        if (p.length !== 2 || Number(p[0]![0]) !== -amount || Number(p[1]![0]) !== amount) return 'a transfer must be two postings that sum to zero';
        continue;
      }
      if (t && String(t[0]) === 'adjustment') {
        const p = await ctx.query('SELECT signed_amount_minor, posting_kind FROM posting WHERE transaction_id = ?', [id]);
        if (p.length !== 1 || String(p[0]![1]) !== 'adjustment' || Math.abs(Number(p[0]![0])) !== Number(t[1]) || Number(t[1]) === 0) return 'an adjustment must be one adjustment posting equal to its amount';
        continue;
      }
      if (!t || (String(t[0]) !== 'expense' && String(t[0]) !== 'income')) continue;
      const p = await ctx.query('SELECT signed_amount_minor FROM posting WHERE transaction_id = ?', [id]);
      const want = String(t[0]) === 'expense' ? -Number(t[1]) : Number(t[1]);
      if (p.length !== 1 || Number(p[0]![0]) !== want) return 'an expense or income must be one posting equal to its amount';
      const s = Number((await ctx.query('SELECT COALESCE(SUM(amount_minor), 0) FROM split WHERE transaction_id = ?', [id]))[0]![0]);
      if (s !== Number(t[1])) return 'splits must add up to the entry amount';
    }
    return null;
  },
};

/** Account the Add sheet should pick: last used with the category, else most recently used, else the first. */
export function pickDefaultAccount(
  activeIds: readonly string[],
  lastForCategory: string | null,
  lastUsed: string | null,
  settingDefault: string | null = null,
): string | null {
  if (lastForCategory && activeIds.includes(lastForCategory)) return lastForCategory;
  if (lastUsed && activeIds.includes(lastUsed)) return lastUsed;
  if (settingDefault && activeIds.includes(settingDefault)) return settingDefault;
  return activeIds[0] ?? null;
}

const LAST_ACCOUNT_BASE =
  "SELECT p.account_id FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id JOIN posting p ON p.transaction_id = t.id JOIN account a ON a.id = p.account_id WHERE t.removed_at IS NULL AND a.status = 'active' AND p.posting_kind = 'normal' AND t.event_type IN ('expense','income')";
export const LAST_ACCOUNT_FOR_CATEGORY_SQL = `${LAST_ACCOUNT_BASE} AND s.category_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 1`;
export const LAST_ACCOUNT_SQL = `${LAST_ACCOUNT_BASE} ORDER BY t.created_at DESC, t.id DESC LIMIT 1`;

/** UTC instant for a local date ("2026-11-08") and time ("18:05") in an IANA timezone; null when invalid. */
export function instantFromLocal(localDate: string, hhmm: string, timezoneId: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const t = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!d || !t) return null;
  const [y, mo, da, h, mi] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, da, h, mi);
  if (new Date(wall).getUTCMonth() !== mo - 1) return null; // 31 February and the like
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: timezoneId, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  } catch {
    return null;
  }
  const wallOf = (ms: number) => {
    const n: Record<string, number> = {};
    for (const p of f.formatToParts(ms)) if (p.type !== 'literal') n[p.type] = Number(p.value);
    return Date.UTC(n.year!, n.month! - 1, n.day!, n.hour!, n.minute!);
  };
  let guess = wall;
  for (let i = 0; i < 3; i++) guess += wall - wallOf(guess);
  return guess;
}
