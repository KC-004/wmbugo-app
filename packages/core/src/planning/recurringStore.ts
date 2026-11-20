import { toLocalDate } from '../shared/clock';
import { readPaydayRule } from '../profile/paydayChange';
import { billOccurrences, nextDue, type BillKind, type BillOccurrence, type BillPayment, type BillRule, type Cadence, type CustomUnit } from './recurring';
import type { Querier } from './budgets';

/** Bill rules that are not removed, oldest first. Columns are read by `mapRules`. */
export const RECURRING_RULES_SQL =
  'SELECT id, title, expected_amount_minor, cadence, custom_every, custom_unit, anchor_date, account_id, category_id, kind, paid_to, ends_on, paused_at, paused_on, resumed_on, ended_at, ended_on, removed_at, remind_days, pause_gaps FROM recurring_rule WHERE removed_at IS NULL ORDER BY created_at, id';

/** One rule by id, removed or not. Param: id. */
export const RECURRING_RULE_SQL =
  'SELECT id, title, expected_amount_minor, cadence, custom_every, custom_unit, anchor_date, account_id, category_id, kind, paid_to, ends_on, paused_at, paused_on, resumed_on, ended_at, ended_on, removed_at, remind_days, pause_gaps FROM recurring_rule WHERE id = ?';

export const RECURRING_PAYMENTS_SQL = 'SELECT rule_id, due_date, payment_kind, transaction_id, recorded_at FROM recurring_payment ORDER BY due_date, rule_id';

const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The earlier pauses stored as JSON `[[from, to], ...]`; anything malformed counts as none. */
function parseGaps(v: unknown): [string, string][] {
  try {
    const x: unknown = JSON.parse(String(v ?? '[]'));
    return Array.isArray(x) ? x.filter((g): g is [string, string] => Array.isArray(g) && g.length === 2 && typeof g[0] === 'string' && typeof g[1] === 'string') : [];
  } catch {
    return [];
  }
}

export function mapRules(rows: readonly (readonly unknown[])[]): BillRule[] {
  return rows.map((r) => ({
    id: String(r[0]),
    title: String(r[1]),
    expectedAmountMinor: Number(r[2]),
    cadence: String(r[3]) as Cadence,
    customEvery: num(r[4]),
    customUnit: text(r[5]) as CustomUnit | null,
    anchorDate: String(r[6]),
    accountId: text(r[7]),
    categoryId: text(r[8]),
    kind: String(r[9]) as BillKind,
    paidTo: text(r[10]),
    endsOn: text(r[11]),
    pausedAt: num(r[12]),
    pausedOn: text(r[13]),
    resumedOn: text(r[14]),
    endedAt: num(r[15]),
    endedOn: text(r[16]),
    removedAt: num(r[17]),
    remindDays: num(r[18]),
    pauseGaps: parseGaps(r[19]),
  }));
}

export const mapPayments = (rows: readonly (readonly unknown[])[]): BillPayment[] =>
  rows.map((r) => ({ ruleId: String(r[0]), dueDate: String(r[1]), kind: String(r[2]) as 'linked' | 'marked', transactionId: text(r[3]), recordedAt: Number(r[4]) }));

/** Today's local date in the profile timezone, from the clock; null before a profile exists. */
export async function localToday(q: Querier, nowMs: number): Promise<string | null> {
  const p = await readPaydayRule(q);
  if (!p) return null;
  const t = toLocalDate(nowMs, p.timezoneId);
  return t.ok ? t.value : null;
}

/**
 * The planning query `billOccurrences(fromDate, toDate)`: per active rule, each due date in the range with its status
 * (`paid`, `upcoming`, `due_soon` with `daysUntilDue`, `not_seen_yet`, or `not_marked_paid` in the history). "Today" comes
 * from the clock in the profile timezone. Read-only: it creates nothing.
 */
export async function loadBillOccurrences(q: Querier, nowMs: number, fromDate: string, toDate: string): Promise<BillOccurrence[]> {
  const today = await localToday(q, nowMs);
  if (today === null) return [];
  const rules = mapRules(await q.query(RECURRING_RULES_SQL));
  return billOccurrences(rules, mapPayments(await q.query(RECURRING_PAYMENTS_SQL)), fromDate, toDate, today);
}

/** A rule's derived next due date, or null (paused, ended, removed, or no date left). */
export async function loadNextDue(q: Querier, nowMs: number, ruleId: string): Promise<string | null> {
  const today = await localToday(q, nowMs);
  const rule = mapRules(await q.query(RECURRING_RULE_SQL, [ruleId]))[0];
  if (today === null || !rule) return null;
  return nextDue(rule, mapPayments(await q.query('SELECT rule_id, due_date, payment_kind, transaction_id, recorded_at FROM recurring_payment WHERE rule_id = ?', [ruleId])), today);
}
