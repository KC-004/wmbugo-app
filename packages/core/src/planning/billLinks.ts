import { err, ok } from '../shared/result';
import { normalizeMerchant } from '../capture/merchant';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { addDays, daysBetween, isLocalDate } from '../profile/period';
import type { Querier } from './budgets';
import { ruleOccurrences, type BillRule } from './recurring';
import { mapPayments, mapRules, RECURRING_PAYMENTS_SQL, RECURRING_RULES_SQL, RECURRING_RULE_SQL } from './recurringStore';

/**
 * Linking a payment to a bill (Story 6.3, REC-009, REC-004). A link is a `recurring_payment` row that carries the entry's id:
 * the entry's amount, category and status never change. The matcher only ever suggests; nothing here links by itself.
 */

/** How far from the due date an entry may be to look like its payment, and how far the picker looks. */
export const MATCH_DAYS = 7;
export const PICKER_DAYS = 15;
/** The amount may differ from the expected one by up to 10 percent, inclusive. */
export const MATCH_TOLERANCE_PERCENT = 10;

export interface BillMatch {
  readonly ruleId: string;
  readonly title: string;
  readonly dueDate: string;
  readonly expectedAmountMinor: number;
}

interface EntryRow {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly removed: boolean;
}

async function readEntry(q: Querier, id: string): Promise<EntryRow | null> {
  const r = (await q.query('SELECT id, event_type, status, amount_minor, local_date, original_description, removed_at FROM "transaction" WHERE id = ?', [id]))[0];
  if (!r) return null;
  return { id: String(r[0]), type: String(r[1]), status: String(r[2]), amountMinor: Number(r[3]), localDate: String(r[4]), merchant: r[5] === null ? null : String(r[5]), removed: r[6] !== null };
}

/** Within ±10% of the expected amount, inclusive, in exact integers. */
export const withinTolerance = (amountMinor: number, expectedMinor: number): boolean => Math.abs(amountMinor - expectedMinor) * 100 <= expectedMinor * MATCH_TOLERANCE_PERCENT;

/** The payee on the rule and the entry's merchant are the same business once normalised (learning's normaliser). */
export const samePayee = (paidTo: string | null, merchant: string | null): boolean => {
  const a = normalizeMerchant(paidTo);
  return a !== '' && a === normalizeMerchant(merchant);
};

interface Candidate {
  readonly rule: BillRule;
  readonly dueDate: string;
  readonly diffDays: number;
  readonly diffMinor: number;
}

/** Unpaid due dates of active rules this entry could be the payment of, best first (nearest due date, then closest amount). */
function candidatesFor(entry: EntryRow, rules: readonly BillRule[], paidKeys: ReadonlySet<string>, dismissed: ReadonlySet<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const rule of rules) {
    if (rule.pausedAt !== null || rule.endedAt !== null || rule.removedAt !== null) continue;
    if (!samePayee(rule.paidTo, entry.merchant) || !withinTolerance(entry.amountMinor, rule.expectedAmountMinor)) continue;
    if (dismissed.has(`${rule.id}|${entry.id}`)) continue;
    for (const d of ruleOccurrences(rule, addDays(entry.localDate, -MATCH_DAYS), addDays(entry.localDate, MATCH_DAYS))) {
      if (paidKeys.has(`${rule.id}|${d}`)) continue;
      out.push({ rule, dueDate: d, diffDays: Math.abs(daysBetween(entry.localDate, d)), diffMinor: Math.abs(entry.amountMinor - rule.expectedAmountMinor) });
    }
  }
  return out.sort((a, b) => a.diffDays - b.diffDays || a.diffMinor - b.diffMinor || (a.rule.title < b.rule.title ? -1 : 1));
}

async function loadState(q: Querier) {
  const rules = mapRules(await q.query(RECURRING_RULES_SQL));
  const payments = mapPayments(await q.query(RECURRING_PAYMENTS_SQL));
  const dismissed = new Set((await q.query('SELECT rule_id, transaction_id FROM recurring_match_dismissed')).map((r) => `${String(r[0])}|${String(r[1])}`));
  return { rules, payments, paidKeys: new Set(payments.map((p) => `${p.ruleId}|${p.dueDate}`)), linkedTx: new Set(payments.map((p) => p.transactionId).filter((x): x is string => x !== null)), dismissed };
}

/**
 * The planning query `findBillMatch(transaction)`: the best unpaid due date this entry looks like the payment of, or null.
 * Only confirmed or waiting expenses match; income, transfers, entries already linked, rules without `paid_to` and a rule the
 * user dismissed for this entry never do. It only suggests: nothing is linked until the user says so.
 */
export async function findBillMatch(q: Querier, transactionId: string): Promise<BillMatch | null> {
  const entry = await readEntry(q, transactionId);
  if (!entry || entry.removed || entry.type !== 'expense' || (entry.status !== 'confirmed' && entry.status !== 'needs_review')) return null;
  const s = await loadState(q);
  if (s.linkedTx.has(entry.id)) return null;
  const best = candidatesFor(entry, s.rules, s.paidKeys, s.dismissed)[0];
  return best ? { ruleId: best.rule.id, title: best.rule.title, dueDate: best.dueDate, expectedAmountMinor: best.rule.expectedAmountMinor } : null;
}

/** The bill an entry is linked to, for `Paid Rent for 5 Dec · Unlink` on its detail. */
export async function billLinkOf(q: Querier, transactionId: string): Promise<{ ruleId: string; title: string; dueDate: string } | null> {
  const r = (await q.query('SELECT p.rule_id, r.title, p.due_date FROM recurring_payment p JOIN recurring_rule r ON r.id = p.rule_id WHERE p.transaction_id = ?', [transactionId]))[0];
  return r ? { ruleId: String(r[0]), title: String(r[1]), dueDate: String(r[2]) } : null;
}

export interface LinkCandidate {
  readonly id: string;
  readonly amountMinor: number;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly accountName: string | null;
  /** The entry fits the bill: same payee, amount within 10%, within 7 days. */
  readonly looksLikeMatch: boolean;
}

const CANDIDATES_SQL =
  "SELECT t.id, t.amount_minor, t.local_date, t.original_description, MAX(c.name), MAX(c.icon), MAX(c.color_token), (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.posting_kind = 'normal' ORDER BY p.signed_amount_minor LIMIT 1), t.note FROM \"transaction\" t LEFT JOIN split s ON s.transaction_id = t.id LEFT JOIN category c ON c.id = s.category_id WHERE t.event_type = 'expense' AND t.status = 'confirmed' AND t.removed_at IS NULL AND t.local_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM recurring_payment rp WHERE rp.transaction_id = t.id) GROUP BY t.id ORDER BY t.local_date DESC, t.id DESC LIMIT 200";

/**
 * The picker behind `Link an entry`: confirmed, unlinked expenses within 15 days of the due date, the ones that look like a
 * match first, optionally narrowed by a search over merchant and note.
 */
export async function linkCandidates(q: Querier, ruleId: string, dueDate: string, search = ''): Promise<LinkCandidate[]> {
  const rule = mapRules(await q.query(RECURRING_RULE_SQL, [ruleId]))[0];
  if (!rule) return [];
  const needle = search.trim().toLowerCase();
  const rows = await q.query(CANDIDATES_SQL, [addDays(dueDate, -PICKER_DAYS), addDays(dueDate, PICKER_DAYS)]);
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const out = rows
    .map((r) => {
      const amountMinor = Number(r[1]);
      const localDate = String(r[2]);
      const merchant = s(r[3]);
      return {
        id: String(r[0]), amountMinor, localDate, merchant, categoryName: s(r[4]), categoryIcon: s(r[5]), categoryColor: s(r[6]), accountName: s(r[7]), note: s(r[8]),
        looksLikeMatch: samePayee(rule.paidTo, merchant) && withinTolerance(amountMinor, rule.expectedAmountMinor) && Math.abs(daysBetween(localDate, dueDate)) <= MATCH_DAYS,
      };
    })
    .filter((e) => needle === '' || (e.merchant ?? '').toLowerCase().includes(needle) || (e.note ?? '').toLowerCase().includes(needle))
    .sort((a, b) => Number(b.looksLikeMatch) - Number(a.looksLikeMatch) || Math.abs(daysBetween(a.localDate, dueDate)) - Math.abs(daysBetween(b.localDate, dueDate)));
  return out.map((e) => ({ id: e.id, amountMinor: e.amountMinor, localDate: e.localDate, merchant: e.merchant, categoryName: e.categoryName, categoryIcon: e.categoryIcon, categoryColor: e.categoryColor, accountName: e.accountName, looksLikeMatch: e.looksLikeMatch }));
}

// ---- Commands --------------------------------------------------------------------------------------------------------

export type LinkBillError =
  | 'RULE_NOT_FOUND'
  | 'ENTRY_NOT_FOUND'
  | 'NOT_AN_EXPENSE'
  | 'NOT_A_DUE_DATE'
  /** `ALREADY_LINKED:<due date>:<bill name>`: this entry already pays a bill. */
  | `ALREADY_LINKED:${string}`
  /** `OCCURRENCE_PAID:<due date>:<bill name>`: that due date already has a payment. */
  | `OCCURRENCE_PAID:${string}`;

/** `This entry is already linked to Rent (5 Dec).` / `Rent for 5 Dec is already paid.` need the date and the name. */
export function parseLinkRefusal(code: string): { kind: 'entry' | 'occurrence'; dueDate: string; title: string } | null {
  const m = /^(ALREADY_LINKED|OCCURRENCE_PAID):(\d{4}-\d{2}-\d{2}):(.*)$/s.exec(code);
  return m ? { kind: m[1] === 'ALREADY_LINKED' ? 'entry' : 'occurrence', dueDate: m[2]!, title: m[3]! } : null;
}

/**
 * Links an entry as the payment of one due date. Done twice (a retry, a double tap, another bill) it is refused and nothing
 * is written, so the next due date moves by exactly one. The entry itself is not touched.
 */
export const LinkBillPayment: UseCase<{ ruleId: string; dueDate: string; transactionId: string }, void, LinkBillError> = {
  name: 'LinkBillPayment',
  async execute(ctx, input) {
    const rule = mapRules(await ctx.query(RECURRING_RULE_SQL, [input.ruleId]))[0];
    if (!rule || rule.removedAt !== null) return err('RULE_NOT_FOUND');
    const entry = await readEntry(ctx, input.transactionId);
    if (!entry || entry.removed) return err('ENTRY_NOT_FOUND');
    if (entry.type !== 'expense' || entry.status === 'excluded') return err('NOT_AN_EXPENSE');
    const mine = await billLinkOf(ctx, entry.id);
    if (mine) return err(`ALREADY_LINKED:${mine.dueDate}:${mine.title}`);
    if (!isLocalDate(input.dueDate) || ruleOccurrences(rule, input.dueDate, input.dueDate).length === 0) return err('NOT_A_DUE_DATE');
    if ((await ctx.query('SELECT 1 FROM recurring_payment WHERE rule_id = ? AND due_date = ?', [rule.id, input.dueDate])).length > 0) return err(`OCCURRENCE_PAID:${input.dueDate}:${rule.title}`);
    await ctx.execute("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, ?, 'linked', ?, ?)", [rule.id, input.dueDate, entry.id, ctx.nowMs()]);
    ctx.touch('recurring_payment', `${rule.id}:${input.dueDate}`, { linked: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [rule.id] });
    return ok(undefined);
  },
};

/** Takes the link off an entry: the due date is unpaid again and the next due date goes back. Undo of a link. */
export const UnlinkBillPayment: UseCase<{ transactionId: string }, { ruleId: string; dueDate: string }, 'NOT_LINKED'> = {
  name: 'UnlinkBillPayment',
  async execute(ctx, input) {
    const link = await billLinkOf(ctx, input.transactionId);
    if (!link) return err('NOT_LINKED');
    await ctx.execute('DELETE FROM recurring_payment WHERE transaction_id = ?', [input.transactionId]);
    ctx.touch('recurring_payment', `${link.ruleId}:${link.dueDate}`, { unlinked: true, label: link.title });
    ctx.emit('RecurringChanged', { ruleIds: [link.ruleId] });
    return ok({ ruleId: link.ruleId, dueDate: link.dueDate });
  },
};

/** `Not this one`: the bill is never offered for this entry again. */
export const DismissBillMatch: UseCase<{ ruleId: string; transactionId: string }, void, 'RULE_NOT_FOUND' | 'ENTRY_NOT_FOUND'> = {
  name: 'DismissBillMatch',
  async execute(ctx, input) {
    if ((await ctx.query('SELECT 1 FROM recurring_rule WHERE id = ? AND removed_at IS NULL', [input.ruleId])).length === 0) return err('RULE_NOT_FOUND');
    if (!(await readEntry(ctx, input.transactionId))) return err('ENTRY_NOT_FOUND');
    await ctx.execute('INSERT OR IGNORE INTO recurring_match_dismissed (rule_id, transaction_id, dismissed_at) VALUES (?, ?, ?)', [input.ruleId, input.transactionId, ctx.nowMs()]);
    ctx.touch('recurring_match_dismissed', `${input.ruleId}:${input.transactionId}`, { dismissed: true });
    ctx.emit('RecurringChanged', { ruleIds: [input.ruleId] });
    return ok(undefined);
  },
};

/**
 * Planning's handler of `TransactionsChanged`: a linked entry that was deleted, rejected or excluded no longer pays its due
 * date, so the payment row goes and the date is unpaid again (`Not seen yet` if it has passed). Restoring the entry does not
 * link it again: the prompt simply shows once more. Running it with nothing to release changes and raises nothing, so a
 * redelivered event is harmless.
 */
export const ReleaseBillLinks: UseCase<Record<string, never>, { released: number }, never> = {
  name: 'ReleaseBillLinks',
  async execute(ctx: WriterContext) {
    const gone = await ctx.query("SELECT p.rule_id, p.due_date, p.transaction_id FROM recurring_payment p JOIN \"transaction\" t ON t.id = p.transaction_id WHERE p.payment_kind = 'linked' AND (t.removed_at IS NOT NULL OR t.status = 'excluded')");
    if (gone.length === 0) return ok({ released: 0 });
    const rules = new Set<string>();
    for (const r of gone) {
      await ctx.execute('DELETE FROM recurring_payment WHERE rule_id = ? AND due_date = ?', [String(r[0]), String(r[1])]);
      ctx.touch('recurring_payment', `${String(r[0])}:${String(r[1])}`, { released: true });
      rules.add(String(r[0]));
    }
    ctx.emit('RecurringChanged', { ruleIds: [...rules] });
    return ok({ released: gone.length });
  },
};
