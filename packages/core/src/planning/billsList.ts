import { addDays } from '../profile/period';
import type { Querier } from './budgets';
import { billOccurrences, monthlyEquivalent, nextDue, roundHalfUp, sumFractions, type BillKind, type BillPayment, type BillRule, type BillStatus, type Cadence, type CustomUnit } from './recurring';
import { localToday, mapPayments, mapRules, RECURRING_PAYMENTS_SQL, RECURRING_RULES_SQL, RECURRING_RULE_SQL } from './recurringStore';

/**
 * The Bills & Recurring list and a bill's detail (Story 6.2, SCR-16). Everything is derived from the rules and the payment
 * rows: nothing here writes, and a bill never reads or changes a ledger figure.
 */

export type BillRowState = 'active' | 'paused' | 'ended';

/** The one status line under a bill: what is true of the occurrence that matters now. */
export interface BillStatusLine {
  readonly kind: 'upcoming' | 'due_soon' | 'paid' | 'not_seen_yet' | 'paused' | 'ended';
  /** The due date the line is about (null for paused and ended). */
  readonly date: string | null;
  readonly daysUntilDue: number | null;
  /** For `paid`: how it was paid. */
  readonly paidBy: 'linked' | 'marked' | null;
  /** For a linked payment: the date of the entry that paid it (it can differ from the due date). */
  readonly paidOn?: string | null;
}

export interface BillRowModel {
  readonly id: string;
  readonly title: string;
  readonly kind: BillKind;
  readonly cadence: Cadence;
  readonly customEvery: number | null;
  readonly customUnit: CustomUnit | null;
  readonly expectedAmountMinor: number;
  readonly accountId: string | null;
  readonly accountName: string | null;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly categoryIcon: string | null;
  readonly categoryColor: string | null;
  readonly state: BillRowState;
  readonly nextDue: string | null;
  readonly status: BillStatusLine;
  readonly hasPayments: boolean;
  /** What it costs per month (yearly / 12, weekly x 52 / 12 ...), rounded half-up on its own; the list total is rounded once. */
  readonly monthlyEquivalentMinor: number;
}

export interface BillsList {
  /** Profile-local today. */
  readonly today: string;
  readonly active: readonly BillRowModel[];
  readonly paused: readonly BillRowModel[];
  readonly ended: readonly BillRowModel[];
  /** The Subscriptions filter's header: active subscriptions only (paused and ended are listed but not counted). */
  readonly subscriptions: { readonly totalMinor: number; readonly counted: number };
}

/** Far enough back to hold one step of the longest cadence (99 months). */
const LOOKBACK_DAYS = 3200;

/** The date and amount of the entries that paid bills, by entry id. */
type LinkedEntries = ReadonlyMap<string, { readonly localDate: string; readonly amountMinor: number; readonly merchant: string | null; readonly categoryName: string | null; readonly categoryIcon: string | null; readonly categoryColor: string | null; readonly accountName: string | null }>;

async function readLinked(q: Querier, payments: readonly BillPayment[]): Promise<LinkedEntries> {
  const ids = payments.map((p) => p.transactionId).filter((x): x is string => x !== null);
  if (ids.length === 0) return new Map();
  const rows = await q.query(
    `SELECT t.id, t.local_date, t.amount_minor, t.original_description, MAX(c.name), MAX(c.icon), MAX(c.color_token), (SELECT a.name FROM posting p JOIN account a ON a.id = p.account_id WHERE p.transaction_id = t.id AND p.posting_kind = 'normal' ORDER BY p.signed_amount_minor LIMIT 1) FROM "transaction" t LEFT JOIN split s ON s.transaction_id = t.id LEFT JOIN category c ON c.id = s.category_id WHERE t.id IN (${ids.map(() => '?').join(',')}) GROUP BY t.id`,
    ids,
  );
  const t = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return new Map(rows.map((r) => [String(r[0]), { localDate: String(r[1]), amountMinor: Number(r[2]), merchant: t(r[3]), categoryName: t(r[4]), categoryIcon: t(r[5]), categoryColor: t(r[6]), accountName: t(r[7]) }]));
}

interface Names {
  readonly accounts: ReadonlyMap<string, string>;
  readonly categories: ReadonlyMap<string, { name: string; icon: string; color: string }>;
}

async function readNames(q: Querier): Promise<Names> {
  const accounts = new Map((await q.query('SELECT id, name FROM account')).map((r) => [String(r[0]), String(r[1])]));
  const categories = new Map((await q.query('SELECT id, name, icon, color_token FROM category')).map((r) => [String(r[0]), { name: String(r[1]), icon: String(r[2]), color: String(r[3]) }]));
  return { accounts, categories };
}

/** The occurrence that matters now: the newest due date up to 3 days ahead, or the next one when nothing is that close. */
function statusFor(rule: BillRule, payments: readonly BillPayment[], today: string, linked: LinkedEntries): { status: BillStatusLine; focusDate: string | null; focusStatus: BillStatus | null } {
  if (rule.endedAt !== null) return { status: { kind: 'ended', date: null, daysUntilDue: null, paidBy: null }, focusDate: null, focusStatus: null };
  if (rule.pausedAt !== null) return { status: { kind: 'paused', date: null, daysUntilDue: null, paidBy: null }, focusDate: null, focusStatus: null };
  const from = rule.anchorDate > addDays(today, -LOOKBACK_DAYS) ? rule.anchorDate : addDays(today, -LOOKBACK_DAYS);
  const last = billOccurrences([rule], payments, from, addDays(today, 3), today).at(-1);
  if (last) {
    const kind = last.status === 'not_marked_paid' ? 'not_seen_yet' : last.status === 'upcoming' ? 'upcoming' : last.status;
    return { status: { kind, date: last.dueDate, daysUntilDue: last.daysUntilDue ?? null, paidBy: last.payment?.kind ?? null, paidOn: last.payment?.transactionId ? (linked.get(last.payment.transactionId)?.localDate ?? null) : null }, focusDate: last.dueDate, focusStatus: last.status };
  }
  const next = nextDue(rule, payments, today);
  return { status: { kind: 'upcoming', date: next, daysUntilDue: null, paidBy: null }, focusDate: null, focusStatus: null };
}

function toRow(rule: BillRule, payments: readonly BillPayment[], names: Names, today: string, linked: LinkedEntries): BillRowModel {
  const mine = payments.filter((p) => p.ruleId === rule.id);
  const cat = rule.categoryId ? names.categories.get(rule.categoryId) : undefined;
  return {
    id: rule.id,
    title: rule.title,
    kind: rule.kind,
    cadence: rule.cadence,
    customEvery: rule.customEvery,
    customUnit: rule.customUnit,
    expectedAmountMinor: rule.expectedAmountMinor,
    accountId: rule.accountId,
    accountName: rule.accountId ? (names.accounts.get(rule.accountId) ?? null) : null,
    categoryId: rule.categoryId,
    categoryName: cat?.name ?? null,
    categoryIcon: cat?.icon ?? null,
    categoryColor: cat?.color ?? null,
    state: rule.endedAt !== null ? 'ended' : rule.pausedAt !== null ? 'paused' : 'active',
    nextDue: nextDue(rule, mine, today),
    status: statusFor(rule, mine, today, linked).status,
    hasPayments: mine.length > 0,
    monthlyEquivalentMinor: roundHalfUp(monthlyEquivalent(rule)),
  };
}

/** SCR-16: active bills by next due date, then the paused and the ended ones. */
export async function loadBillsList(q: Querier, nowMs: number): Promise<BillsList | null> {
  const today = await localToday(q, nowMs);
  if (today === null) return null;
  const rules = mapRules(await q.query(RECURRING_RULES_SQL));
  const payments = mapPayments(await q.query(RECURRING_PAYMENTS_SQL));
  const names = await readNames(q);
  const linked = await readLinked(q, payments);
  const rows = rules.map((r) => toRow(r, payments, names, today, linked));
  const byDue = (a: BillRowModel, b: BillRowModel) => (a.nextDue ?? '9999') < (b.nextDue ?? '9999') ? -1 : (a.nextDue ?? '9999') > (b.nextDue ?? '9999') ? 1 : a.title.localeCompare(b.title);
  const subs = rules.filter((r) => r.kind === 'subscription' && r.endedAt === null && r.pausedAt === null);
  return {
    today,
    subscriptions: { totalMinor: roundHalfUp(sumFractions(subs.map(monthlyEquivalent))), counted: subs.length },
    active: rows.filter((r) => r.state === 'active').sort(byDue),
    paused: rows.filter((r) => r.state === 'paused'),
    ended: rows.filter((r) => r.state === 'ended'),
  };
}

export interface BillHistoryItem {
  readonly dueDate: string;
  /** `paid` (linked or marked), `not_marked_paid` (a past date nobody marked), or `not_seen_yet` (the newest such date). */
  readonly status: 'paid' | 'not_marked_paid' | 'not_seen_yet';
  readonly paidBy: 'linked' | 'marked' | null;
  readonly transactionId: string | null;
  /** For a linked payment: the entry's date and its actual amount (it can differ from the expected one). */
  readonly paidOn: string | null;
  readonly paidAmountMinor: number | null;
  /** For a linked payment: what the entry looks like, so a subscription's Past charges can show it as an Activity row. */
  readonly entry: { readonly merchant: string | null; readonly categoryName: string | null; readonly categoryIcon: string | null; readonly categoryColor: string | null; readonly accountName: string | null } | null;
}

export interface BillDetail {
  readonly rule: BillRule;
  readonly row: BillRowModel;
  readonly today: string;
  /** Newest first, the last 24 due dates up to today. */
  readonly history: readonly BillHistoryItem[];
  /** The due date `Mark as paid` is for: the unpaid date that matters now, else the next; null when none (paused, ended). */
  readonly markableDate: string | null;
  /** `Delete` is offered only when the bill has no payment history. */
  readonly canDelete: boolean;
}

export async function loadBillDetail(q: Querier, nowMs: number, id: string): Promise<BillDetail | 'missing' | null> {
  const today = await localToday(q, nowMs);
  if (today === null) return null;
  const rule = mapRules(await q.query(RECURRING_RULE_SQL, [id]))[0];
  if (!rule || rule.removedAt !== null) return 'missing';
  const payments = mapPayments(await q.query('SELECT rule_id, due_date, payment_kind, transaction_id, recorded_at FROM recurring_payment WHERE rule_id = ?', [id]));
  const linked = await readLinked(q, payments);
  const row = toRow(rule, payments, await readNames(q), today, linked);
  const from = rule.anchorDate > addDays(today, -LOOKBACK_DAYS) ? rule.anchorDate : addDays(today, -LOOKBACK_DAYS);
  const history: BillHistoryItem[] = billOccurrences([rule], payments, from, today, today)
    .filter((o) => o.status === 'paid' || o.status === 'not_marked_paid' || o.status === 'not_seen_yet')
    .map((o) => ({ dueDate: o.dueDate, status: o.status as BillHistoryItem['status'], paidBy: o.payment?.kind ?? null, transactionId: o.payment?.transactionId ?? null, paidOn: o.payment?.transactionId ? (linked.get(o.payment.transactionId)?.localDate ?? null) : null, paidAmountMinor: o.payment?.transactionId ? (linked.get(o.payment.transactionId)?.amountMinor ?? null) : null, entry: o.payment?.transactionId ? (() => { const e = linked.get(o.payment!.transactionId!); return e ? { merchant: e.merchant, categoryName: e.categoryName, categoryIcon: e.categoryIcon, categoryColor: e.categoryColor, accountName: e.accountName } : null; })() : null }))
    .reverse()
    .slice(0, 24);
  const focus = statusFor(rule, payments, today, linked);
  const markable = rule.pausedAt !== null || rule.endedAt !== null ? null : focus.focusDate !== null && focus.focusStatus !== 'paid' ? focus.focusDate : row.nextDue;
  return { rule, row, today, history, markableDate: markable, canDelete: !row.hasPayments };
}
